import { z } from "zod";

export const PackageFileNameSchema = z.string()
  .trim()
  .min(1)
  .max(180)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._()\-]*\.pkg$/iu, "Use a .pkg file name without path separators.");

export const PackageUploadRequestSchema = z.object({
  fileName: PackageFileNameSchema,
  sizeBytes: z.number().int().positive().safe(),
}).strict();

export const PackageSummarySchema = z.object({
  id: z.string().uuid(),
  file_name: PackageFileNameSchema,
  size_bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).nullable(),
  status: z.enum(["uploading", "ready", "failed"]),
  title_id: z.string().nullable(),
  content_id: z.string().nullable(),
  version: z.string().nullable(),
  created_at: z.string(),
}).strict();

export const ImportJobRequestSchema = z.object({
  sourceUrl: z.string().url().max(4096),
  fileName: PackageFileNameSchema,
}).strict();

export const ImportJobSchema = z.object({
  id: z.string().uuid(),
  file_name: PackageFileNameSchema,
  status: z.enum(["queued", "running", "completed", "failed"]),
  progress_bytes: z.number().int().nonnegative(),
  total_bytes: z.number().int().nonnegative().nullable(),
  error_code: z.string().nullable(),
  package_id: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}).strict();
