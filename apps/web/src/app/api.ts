import type { AuthSession } from "./auth";

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:8080";

export interface PackageItem {
  id: string;
  file_name: string;
  size_bytes: number;
  sha256: string | null;
  status: "uploading" | "ready" | "failed";
  title_id: string | null;
  content_id: string | null;
  version: string | null;
  created_at: string;
}

export interface ImportJob {
  id: string;
  file_name: string;
  status: "queued" | "running" | "completed" | "failed";
  progress_bytes: number;
  total_bytes: number | null;
  error_code: string | null;
  package_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function apiRequest<T>(session: AuthSession, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiRequestError(typeof body?.error === "string" ? body.error : "REQUEST_FAILED", response.status);
  return body as T;
}

export class ApiRequestError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "ApiRequestError";
  }
}

export async function uploadFile(session: AuthSession, file: File, onProgress: (value: number) => void): Promise<PackageItem> {
  const { uploadUrl, packageId } = await apiRequest<{ uploadUrl: string; packageId: string }>(session, "/api/v1/packages/upload-url", {
    method: "POST",
    body: JSON.stringify({ fileName: file.name, sizeBytes: file.size }),
  });
  await putFile(uploadUrl, file, onProgress);
  const result = await apiRequest<{ package: PackageItem }>(session, `/api/v1/packages/${packageId}/complete`, { method: "POST" });
  return result.package;
}

export function putFile(url: string, file: File, onProgress: (value: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error("R2 upload failed."));
    request.onerror = () => reject(new Error("R2 upload failed. Check your connection and retry."));
    request.onabort = () => reject(new Error("Upload cancelled."));
    request.send(file);
  });
}

export function apiOrigin() {
  return apiBase;
}
