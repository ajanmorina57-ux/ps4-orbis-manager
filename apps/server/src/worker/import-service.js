import { randomUUID } from "node:crypto";
import { ImportJobSchema } from "@orbis/contracts";
import { HttpError } from "../http/errors.js";
import { parseAllowedSourceUrl, resolvePublicAddress } from "../security/ssrf.js";

export class ImportJobService {
  constructor({ supabase, allowedHosts }) {
    this.supabase = supabase;
    this.allowedHosts = allowedHosts;
  }

  async list(accessToken, userId) {
    const rows = await this.supabase.userRequest(accessToken, "import_jobs", "GET", {
      select: "id,file_name,status,progress_bytes,total_bytes,error_code,package_id,created_at,updated_at",
      user_id: `eq.${userId}`,
      order: "created_at.desc",
      limit: "50",
    });
    return Array.isArray(rows) ? rows : [];
  }

  async create(accessToken, userId, input) {
    if (!this.allowedHosts.length) throw new HttpError(503, "URL_IMPORT_DISABLED");
    let url;
    try {
      url = parseAllowedSourceUrl(input.sourceUrl, this.allowedHosts);
      await resolvePublicAddress(url.hostname);
    } catch (error) {
      throw new HttpError(400, error.code ?? "URL_NOT_ALLOWED");
    }
    const rows = await this.supabase.serviceRequest("import_jobs", "POST", { select: "id,file_name,status,progress_bytes,total_bytes,error_code,package_id,created_at,updated_at" }, {
      id: randomUUID(),
      user_id: userId,
      file_name: input.fileName,
      source_url: url.toString(),
      status: "queued",
      progress_bytes: 0,
      attempts: 0,
    }, "return=representation");
    const parsed = ImportJobSchema.safeParse(rows?.[0]);
    if (!parsed.success) throw new HttpError(500, "IMPORT_CREATE_FAILED");
    return parsed.data;
  }
}
