import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { errorHandler } from "./errors.js";
import { requireAuth } from "../middleware/auth.js";
import { registerPackageRoutes } from "../packages/routes.js";
import { registerImportRoutes } from "../worker/routes.js";

export function createApp({ config, authService, packageService, importService, logger = console }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((request, response, next) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    request.log = (event, fields = {}) => logger.info(JSON.stringify({ event, requestId, ...fields }));
    response.setHeader("X-Request-Id", requestId);
    response.on("finish", () => request.log("http.request", {
      method: request.method,
      path: request.path,
      status: response.statusCode,
      durationMs: Date.now() - startedAt,
    }));
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    response.setHeader("Cross-Origin-Resource-Policy", "same-site");
    if (config.NODE_ENV === "production") response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });
  app.use(cors({
    origin(origin, callback) {
      if (isOriginAllowed(origin, config.origins)) return callback(null, true);
      return callback(new Error("CORS origin denied"));
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    credentials: false,
    maxAge: 600,
  }));
  app.use(express.json({ limit: "64kb", strict: true }));
  app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false }));

  app.get("/healthz", (_request, response) => response.status(200).json({ status: "ok" }));
  app.get("/readyz", (_request, response) => response.status(config.ready ? 200 : 503).json({ ready: config.ready }));
  app.get("/api/v1", (_request, response) => response.json({ name: "Orbis Manager API", version: "v1" }));

  const auth = requireAuth(authService);
  registerPackageRoutes(app, auth, packageService);
  registerImportRoutes(app, auth, importService);

  app.use((_request, response) => response.status(404).json({ error: "NOT_FOUND" }));
  app.use(errorHandler);
  return app;
}

export function isOriginAllowed(origin, origins) {
  return !origin || origins.includes(origin);
}
