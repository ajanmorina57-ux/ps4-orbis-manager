import { createHash, randomUUID } from "node:crypto";
import { HttpError } from "../http/errors.js";
import { openPublicDownload } from "./source-download.js";

const PART_BYTES = 16 * 1024 * 1024;
const MAX_PARTS = 10_000;
const MAX_ATTEMPTS = 3;

export class ImportProcessor {
  constructor({ supabase, storage, allowedHosts, maxPackageBytes, logger = console }) {
    this.supabase = supabase;
    this.storage = storage;
    this.allowedHosts = allowedHosts;
    this.maxPackageBytes = maxPackageBytes;
    this.logger = logger;
  }

  async claimAndProcess(signal) {
    const claimed = await this.supabase.rpc("claim_import_job", { lease_seconds: 180 });
    const job = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!job) return false;
    try {
      await this.process(job, signal);
    } catch (error) {
      await this.fail(job, error);
    }
    return true;
  }

  async process(job, signal) {
    const packageId = randomUUID();
    const objectKey = `users/${job.user_id}/packages/${packageId}.pkg`;
    const source = await openPublicDownload(job.source_url, { allowedHosts: this.allowedHosts, signal });
    if (source.contentLength !== null && source.contentLength > this.maxPackageBytes) {
      source.stream.destroy();
      throw new Error("PACKAGE_TOO_LARGE");
    }
    const multipart = await this.storage.createMultipartUpload(objectKey);
    let uploaded = false;
    try {
      const digest = createHash("sha256");
      const etags = [];
      let pending = Buffer.alloc(0);
      let sizeBytes = 0;
      const sendPart = async (part) => {
        if (etags.length >= MAX_PARTS) throw new Error("PACKAGE_TOO_LARGE");
        etags.push(await this.storage.uploadPart(objectKey, multipart.uploadId, etags.length + 1, part));
        await this.updateProgress(job.id, sizeBytes, source.contentLength);
      };

      for await (const chunkValue of source.stream) {
        if (signal.aborted) throw signal.reason ?? new Error("WORKER_STOPPING");
        const chunk = Buffer.from(chunkValue);
        sizeBytes += chunk.byteLength;
        if (sizeBytes > this.maxPackageBytes) throw new Error("PACKAGE_TOO_LARGE");
        digest.update(chunk);
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        while (pending.length >= PART_BYTES) {
          const part = pending.subarray(0, PART_BYTES);
          pending = pending.subarray(PART_BYTES);
          await sendPart(part);
        }
      }
      if (source.contentLength !== null && sizeBytes !== source.contentLength) throw new Error("INCOMPLETE_DOWNLOAD");
      if (sizeBytes === 0) throw new Error("EMPTY_DOWNLOAD");
      if (pending.length) await sendPart(pending);
      await this.storage.completeMultipartUpload(objectKey, multipart.uploadId, etags);
      uploaded = true;

      const packageRecord = {
        id: packageId,
        user_id: job.user_id,
        file_name: job.file_name,
        object_key: objectKey,
        size_bytes: sizeBytes,
        sha256: digest.digest("hex"),
        status: "ready",
        import_job_id: job.id,
      };
      await this.supabase.serviceRequest("packages", "POST", {}, packageRecord, "return=minimal");
      await this.supabase.serviceRequest("import_jobs", "PATCH", { id: `eq.${job.id}` }, {
        status: "completed",
        progress_bytes: sizeBytes,
        total_bytes: sizeBytes,
        package_id: packageId,
        error_code: null,
        lease_until: null,
        updated_at: new Date().toISOString(),
      });
    } catch (error) {
      if (!uploaded) await this.storage.abortMultipartUpload(objectKey, multipart.uploadId).catch(() => {});
      else await this.storage.deleteObject(objectKey).catch(() => {});
      throw error;
    }
  }

  async updateProgress(jobId, progressBytes, totalBytes) {
    await this.supabase.serviceRequest("import_jobs", "PATCH", { id: `eq.${jobId}`, status: "eq.running" }, {
      progress_bytes: progressBytes,
      ...(totalBytes === null ? {} : { total_bytes: totalBytes }),
      updated_at: new Date().toISOString(),
    });
  }

  async fail(job, error) {
    const code = error instanceof HttpError ? error.code : sanitizeErrorCode(error?.message);
    const finished = job.attempts >= MAX_ATTEMPTS;
    await this.supabase.serviceRequest("import_jobs", "PATCH", { id: `eq.${job.id}` }, {
      status: finished ? "failed" : "queued",
      error_code: finished ? code : null,
      available_at: new Date(Date.now() + retryDelay(job.attempts)).toISOString(),
      lease_until: null,
      updated_at: new Date().toISOString(),
    });
    this.logger.error(JSON.stringify({ event: "import.failed", jobId: job.id, code, attempt: job.attempts }));
  }
}

function retryDelay(attempt) {
  return Math.min(60_000 * 2 ** Math.max(attempt - 1, 0), 15 * 60_000);
}

function sanitizeErrorCode(value) {
  const allowed = new Set([
    "IMPORT_REDIRECT_LIMIT", "SOURCE_HTTP_ERROR", "SOURCE_TIMEOUT", "INVALID_SOURCE_LENGTH",
    "PACKAGE_TOO_LARGE", "INCOMPLETE_DOWNLOAD", "EMPTY_DOWNLOAD", "WORKER_STOPPING",
    "UNSAFE_DESTINATION", "HOST_NOT_ALLOWED", "URL_NOT_ALLOWED", "INVALID_URL",
  ]);
  return allowed.has(value) ? value : "IMPORT_FAILED";
}
