import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default("orbis-packages"),
  R2_REGION: z.string().default("auto"),
  IMPORT_ALLOWED_HOSTS: z.string().default(""),
  MAX_PACKAGE_BYTES: z.coerce.number().int().positive().safe().default(50 * 1024 ** 3),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
});

export function loadConfig(source = process.env) {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }
  const value = parsed.data;
  const origins = value.WEB_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
  const allowedImportHosts = value.IMPORT_ALLOWED_HOSTS.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  const supabaseConfigured = Boolean(value.SUPABASE_URL && value.SUPABASE_ANON_KEY);
  const serviceConfigured = Boolean(value.SUPABASE_URL && value.SUPABASE_ANON_KEY && value.SUPABASE_SERVICE_ROLE_KEY);
  const storageConfigured = Boolean(value.R2_ACCOUNT_ID && value.R2_ACCESS_KEY_ID && value.R2_SECRET_ACCESS_KEY);
  return {
    ...value,
    origins,
    allowedImportHosts,
    supabaseConfigured,
    serviceConfigured,
    storageConfigured,
    ready: supabaseConfigured && storageConfigured,
  };
}

export function assertRuntimeConfig(config) {
  const missing = [];
  if (!config.supabaseConfigured) missing.push("SUPABASE_URL", "SUPABASE_ANON_KEY");
  if (!config.serviceConfigured) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!config.storageConfigured) missing.push("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY");
  if (missing.length) throw new Error(`Missing required runtime secrets: ${[...new Set(missing)].join(", ")}`);
}
