import { randomUUID } from "node:crypto";
import { HttpError } from "../http/errors.js";

const PACKAGE_COLUMNS = "id,user_id,file_name,object_key,size_bytes,sha256,status,title_id,content_id,version,created_at";

export class PackageService {
  constructor({ supabase, storage, maxPackageBytes, urlTtlSeconds }) {
    this.supabase = supabase;
    this.storage = storage;
    this.maxPackageBytes = maxPackageBytes;
    this.urlTtlSeconds = urlTtlSeconds;
  }

  async list(accessToken, userId) {
    const rows = await this.supabase.userRequest(accessToken, "packages", "GET", {
      select: "id,file_name,size_bytes,sha256,status,title_id,content_id,version,created_at",
      user_id: `eq.${userId}`,
      order: "created_at.desc",
      limit: "100",
    });
    return Array.isArray(rows) ? rows : [];
  }

  async createUpload(accessToken, userId, input) {
    if (input.sizeBytes > this.maxPackageBytes) throw new HttpError(413, "PACKAGE_TOO_LARGE");
    const id = randomUUID();
    const objectKey = `users/${userId}/packages/${id}.pkg`;
    const rows = await this.supabase.serviceRequest("packages", "POST", { select: PACKAGE_COLUMNS }, {
      id,
      user_id: userId,
      file_name: input.fileName,
      object_key: objectKey,
      size_bytes: input.sizeBytes,
      status: "uploading",
    }, "return=representation");
    if (!Array.isArray(rows) || !rows[0]) throw new HttpError(500, "PACKAGE_CREATE_FAILED");
    try {
      const url = await this.storage.createUploadUrl(objectKey);
      return { packageId: id, uploadUrl: url.toString(), expiresInSeconds: this.urlTtlSeconds };
    } catch {
      await this.supabase.serviceRequest("packages", "DELETE", { id: `eq.${id}`, user_id: `eq.${userId}` }).catch(() => {});
      throw new HttpError(503, "STORAGE_UNAVAILABLE");
    }
  }

  async completeUpload(accessToken, userId, packageId) {
    const record = await this.getRecord(accessToken, userId, packageId);
    if (record.status === "ready") return toPublicPackage(record);
    if (record.status !== "uploading") throw new HttpError(409, "PACKAGE_NOT_UPLOADABLE");
    let integrity;
    try {
      integrity = await this.storage.hashObject(record.object_key, record.size_bytes, this.maxPackageBytes);
    } catch {
      throw new HttpError(409, "UPLOAD_INCOMPLETE_OR_INVALID");
    }
    const rows = await this.supabase.serviceRequest("packages", "PATCH", {
      id: `eq.${packageId}`,
      user_id: `eq.${userId}`,
      status: "eq.uploading",
      select: PACKAGE_COLUMNS,
    }, { status: "ready", sha256: integrity.sha256 }, "return=representation");
    if (!Array.isArray(rows) || !rows[0]) throw new HttpError(409, "PACKAGE_STATE_CHANGED");
    return toPublicPackage(rows[0]);
  }

  async createDownloadUrl(accessToken, userId, packageId) {
    const record = await this.getRecord(accessToken, userId, packageId);
    if (record.status !== "ready") throw new HttpError(409, "PACKAGE_NOT_READY");
    const url = await this.storage.createDownloadUrl(record.object_key);
    return { downloadUrl: url.toString(), expiresInSeconds: this.urlTtlSeconds };
  }

  async remove(accessToken, userId, packageId) {
    const record = await this.getRecord(accessToken, userId, packageId);
    try {
      await this.storage.deleteObject(record.object_key);
    } catch {
      throw new HttpError(503, "STORAGE_UNAVAILABLE");
    }
    await this.supabase.serviceRequest("packages", "DELETE", {
      id: `eq.${packageId}`,
      user_id: `eq.${userId}`,
    });
  }

  async getRecord(accessToken, userId, packageId) {
    const rows = await this.supabase.serviceRequest("packages", "GET", {
      select: PACKAGE_COLUMNS,
      id: `eq.${packageId}`,
      user_id: `eq.${userId}`,
      limit: "1",
    });
    if (!Array.isArray(rows) || !rows[0]) throw new HttpError(404, "PACKAGE_NOT_FOUND");
    return rows[0];
  }
}

export function toPublicPackage(record) {
  return {
    id: record.id,
    file_name: record.file_name,
    size_bytes: record.size_bytes,
    sha256: record.sha256,
    status: record.status,
    title_id: record.title_id,
    content_id: record.content_id,
    version: record.version,
    created_at: record.created_at,
  };
}
