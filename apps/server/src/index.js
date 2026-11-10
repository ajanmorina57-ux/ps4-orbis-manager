import { createServer } from "node:http";
import { loadConfig, assertRuntimeConfig } from "./config/env.js";
import { createApp } from "./http/app.js";
import { PackageService } from "./packages/service.js";
import { R2Storage } from "./storage/r2.js";
import { SupabaseRest } from "./supabase/rest.js";
import { ImportJobService } from "./worker/import-service.js";
import { ImportProcessor } from "./worker/processor.js";
import { ImportWorker } from "./worker/worker.js";

const config = loadConfig();
if (config.NODE_ENV === "production") assertRuntimeConfig(config);

const supabase = new SupabaseRest(config);
const storage = new R2Storage(config);
const app = createApp({
  config,
  authService: supabase,
  packageService: new PackageService({
    supabase,
    storage,
    maxPackageBytes: config.MAX_PACKAGE_BYTES,
    urlTtlSeconds: config.SIGNED_URL_TTL_SECONDS,
  }),
  importService: new ImportJobService({ supabase, allowedHosts: config.allowedImportHosts }),
});
const server = createServer(app);
let worker;

if (config.serviceConfigured && config.storageConfigured && config.allowedImportHosts.length) {
  worker = new ImportWorker(new ImportProcessor({
    supabase,
    storage,
    allowedHosts: config.allowedImportHosts,
    maxPackageBytes: config.MAX_PACKAGE_BYTES,
  }));
  worker.start();
} else if (config.NODE_ENV !== "test") {
  console.warn("Orbis Manager started without cloud integrations; /readyz will remain unavailable.");
}

server.listen(config.PORT, "0.0.0.0", () => {
  console.info(JSON.stringify({ event: "server.started", port: config.PORT, workerEnabled: Boolean(worker) }));
});

let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => { void shutdown(signal); });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(JSON.stringify({ event: "server.shutdown", signal }));
  const hardStop = setTimeout(() => {
    server.closeAllConnections?.();
    process.exit(1);
  }, 55_000);
  hardStop.unref();
  const closeServer = new Promise((resolve) => server.close(resolve));
  await Promise.all([closeServer, worker?.stop()]);
  clearTimeout(hardStop);
}
