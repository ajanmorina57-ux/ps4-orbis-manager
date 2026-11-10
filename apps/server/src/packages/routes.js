import { PackageUploadRequestSchema } from "@orbis/contracts";
import { HttpError } from "../http/errors.js";

export function registerPackageRoutes(app, auth, service) {
  app.get("/api/v1/packages", auth, async (request, response, next) => {
    try {
      response.json({ packages: await service.list(request.auth.accessToken, request.auth.user.id) });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/packages/upload-url", auth, async (request, response, next) => {
    try {
      const parsed = PackageUploadRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new HttpError(400, "INVALID_REQUEST");
      response.status(201).json(await service.createUpload(request.auth.accessToken, request.auth.user.id, {
        fileName: parsed.data.fileName,
        sizeBytes: parsed.data.sizeBytes,
      }));
    } catch (error) { next(error); }
  });

  app.post("/api/v1/packages/:id/complete", auth, async (request, response, next) => {
    try {
      if (!isUuid(request.params.id)) throw new HttpError(400, "INVALID_PACKAGE_ID");
      response.json({ package: await service.completeUpload(request.auth.accessToken, request.auth.user.id, request.params.id) });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/packages/:id/download-url", auth, async (request, response, next) => {
    try {
      if (!isUuid(request.params.id)) throw new HttpError(400, "INVALID_PACKAGE_ID");
      response.json(await service.createDownloadUrl(request.auth.accessToken, request.auth.user.id, request.params.id));
    } catch (error) { next(error); }
  });

  app.delete("/api/v1/packages/:id", auth, async (request, response, next) => {
    try {
      if (!isUuid(request.params.id)) throw new HttpError(400, "INVALID_PACKAGE_ID");
      await service.remove(request.auth.accessToken, request.auth.user.id, request.params.id);
      response.status(204).end();
    } catch (error) { next(error); }
  });
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
