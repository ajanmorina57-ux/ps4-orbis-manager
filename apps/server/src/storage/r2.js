import { createHash, createHmac } from "node:crypto";

const AWS_ALGORITHM = "AWS4-HMAC-SHA256";

export class R2Storage {
  constructor(config, fetchImpl = fetch) {
    this.accountId = config.R2_ACCOUNT_ID;
    this.accessKeyId = config.R2_ACCESS_KEY_ID;
    this.secretAccessKey = config.R2_SECRET_ACCESS_KEY;
    this.bucket = config.R2_BUCKET;
    this.region = config.R2_REGION;
    this.ttlSeconds = config.SIGNED_URL_TTL_SECONDS;
    this.endpoint = new URL(`https://${this.accountId}.r2.cloudflarestorage.com`);
    this.fetchImpl = fetchImpl;
  }

  createUploadUrl(key) {
    return this.presign("PUT", key);
  }

  createDownloadUrl(key) {
    return this.presign("GET", key);
  }

  async hashObject(key, expectedBytes, maxBytes) {
    const response = await this.fetchImpl(await this.presign("GET", key, 60), { redirect: "error" });
    if (!response.ok || !response.body) throw new Error("Stored package could not be read for verification.");
    const hash = createHash("sha256");
    let sizeBytes = 0;
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      sizeBytes += bytes.length;
      if (sizeBytes > maxBytes) throw new Error("Stored package exceeded the configured size limit.");
      hash.update(bytes);
    }
    if (sizeBytes !== expectedBytes) throw new Error("Uploaded object size did not match the declared size.");
    return { sizeBytes, sha256: hash.digest("hex") };
  }

  async deleteObject(key) {
    const response = await this.signedRequest("DELETE", key);
    if (!response.ok && response.status !== 404) throw new Error(`R2 delete failed with HTTP ${response.status}.`);
  }

  async createMultipartUpload(key, contentType = "application/octet-stream") {
    const response = await this.signedRequest("POST", key, "uploads=");
    if (!response.ok) throw new Error(`R2 multipart setup failed with HTTP ${response.status}.`);
    const xml = await response.text();
    const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(xml)?.[1];
    if (!uploadId) throw new Error("R2 returned an invalid multipart upload response.");
    return { uploadId, contentType };
  }

  async uploadPart(key, uploadId, partNumber, bytes) {
    const query = `partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`;
    const response = await this.signedRequest("PUT", key, query, bytes);
    if (!response.ok) throw new Error(`R2 upload part failed with HTTP ${response.status}.`);
    const etag = response.headers.get("etag");
    if (!etag) throw new Error("R2 upload part did not include an ETag.");
    return etag;
  }

  async completeMultipartUpload(key, uploadId, etags) {
    const parts = etags.map((etag, index) => `<Part><PartNumber>${index + 1}</PartNumber><ETag>${xmlEscape(etag)}</ETag></Part>`).join("");
    const body = Buffer.from(`<CompleteMultipartUpload>${parts}</CompleteMultipartUpload>`);
    const response = await this.signedRequest("POST", key, `uploadId=${encodeURIComponent(uploadId)}`, body, {
      "content-type": "application/xml",
    });
    if (!response.ok) throw new Error(`R2 multipart completion failed with HTTP ${response.status}.`);
    await response.arrayBuffer();
  }

  async abortMultipartUpload(key, uploadId) {
    const response = await this.signedRequest("DELETE", key, `uploadId=${encodeURIComponent(uploadId)}`);
    if (!response.ok && response.status !== 404) throw new Error(`R2 multipart abort failed with HTTP ${response.status}.`);
  }

  async presign(method, key, expiresIn = this.ttlSeconds) {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const query = [
      ["X-Amz-Algorithm", AWS_ALGORITHM],
      ["X-Amz-Credential", `${this.accessKeyId}/${credentialScope}`],
      ["X-Amz-Date", amzDate],
      ["X-Amz-Expires", String(expiresIn)],
      ["X-Amz-SignedHeaders", "host"],
    ].sort(([left], [right]) => left.localeCompare(right));
    const canonicalQuery = query.map(([name, value]) => `${awsEncode(name)}=${awsEncode(value)}`).join("&");
    const canonicalRequest = [method, this.pathFor(key), canonicalQuery, `host:${this.endpoint.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
    const stringToSign = [AWS_ALGORITHM, amzDate, credentialScope, sha256(canonicalRequest)].join("\n");
    const signature = hmac(this.signingKey(dateStamp), stringToSign, "hex");
    const url = new URL(this.pathFor(key), this.endpoint);
    for (const [name, value] of query) url.searchParams.append(name, value);
    url.searchParams.set("X-Amz-Signature", signature);
    return url;
  }

  async signedRequest(method, key, rawQuery = "", body = Buffer.alloc(0), extraHeaders = {}) {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const url = new URL(this.pathFor(key), this.endpoint);
    url.search = canonicalRawQuery(rawQuery);
    const payloadHash = sha256(body);
    const headers = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...extraHeaders,
    };
    const signedHeaders = Object.keys(headers).map((header) => header.toLowerCase()).sort();
    const canonicalHeaders = signedHeaders.map((header) => `${header}:${normalizeHeader(headers[header])}\n`).join("");
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const canonicalRequest = [method, url.pathname, canonicalRawQuery(url.search.slice(1)), canonicalHeaders, signedHeaders.join(";"), payloadHash].join("\n");
    const stringToSign = [AWS_ALGORITHM, amzDate, credentialScope, sha256(canonicalRequest)].join("\n");
    headers.authorization = `${AWS_ALGORITHM} Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders.join(";")}, Signature=${hmac(this.signingKey(dateStamp), stringToSign, "hex")}`;
    return this.fetchImpl(url, { method, headers, ...(body.length ? { body } : {}), redirect: "error" });
  }

  signingKey(dateStamp) {
    const kDate = hmac(Buffer.from(`AWS4${this.secretAccessKey}`), dateStamp);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, "s3");
    return hmac(kService, "aws4_request");
  }

  pathFor(key) {
    return `/${awsEncode(this.bucket)}/${key.split("/").map(awsEncode).join("/")}`;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding) {
  const result = createHmac("sha256", key).update(value);
  return encoding ? result.digest(encoding) : result.digest();
}

function awsEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalRawQuery(rawQuery) {
  if (!rawQuery) return "";
  return rawQuery.split("&").filter(Boolean).map((item) => {
    const [key, ...rest] = item.split("=");
    return [awsEncode(decodeURIComponent(key)), awsEncode(decodeURIComponent(rest.join("=")))];
  }).sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv))
    .map(([key, value]) => `${key}=${value}`).join("&");
}

function normalizeHeader(value) {
  return String(value).trim().replace(/\s+/g, " ");
}

function xmlEscape(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
