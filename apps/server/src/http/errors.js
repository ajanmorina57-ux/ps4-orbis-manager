export class HttpError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function errorHandler(error, request, response, _next) {
  if (response.headersSent) return;
  if (error?.message === "CORS origin denied") return response.status(403).json({ error: "ORIGIN_NOT_ALLOWED" });
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
  const code = typeof error?.code === "string" && /^[A-Z0-9_]{2,50}$/.test(error.code)
    ? error.code
    : status === 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED";
  if (status >= 500) request.log?.("request.error", { code });
  return response.status(status).json({ error: code });
}
