import { ImportJobRequestSchema } from "@orbis/contracts";
import { HttpError } from "../http/errors.js";

export function registerImportRoutes(app, auth, service) {
  app.get("/api/v1/import-jobs", auth, async (request, response, next) => {
    try {
      response.json({ jobs: await service.list(request.auth.accessToken, request.auth.user.id) });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/import-jobs", auth, async (request, response, next) => {
    try {
      const parsed = ImportJobRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new HttpError(400, "INVALID_REQUEST");
      const job = await service.create(request.auth.accessToken, request.auth.user.id, parsed.data);
      response.status(202).json({ job });
    } catch (error) { next(error); }
  });
}
