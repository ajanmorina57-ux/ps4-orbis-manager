import test from "node:test";
import assert from "node:assert/strict";
import { createApp, isOriginAllowed } from "../src/http/app.js";
import { errorHandler } from "../src/http/errors.js";

function makeApp(overrides = {}) {
  const config = { NODE_ENV: "test", origins: ["https://app.example"], ready: true, ...overrides.config };
  const authService = { getUser: async (token) => token === "valid-token" ? { id: "user-a" } : undefined };
  const packageService = {
    list: async (_token, userId) => [{ id: "owned", owner: userId }],
    createUpload: async (_token, userId, input) => ({ packageId: "pkg-1", owner: userId, input }),
    completeUpload: async () => ({}),
    createDownloadUrl: async () => ({}),
    remove: async () => {},
    ...overrides.packageService,
  };
  const importService = { list: async () => [], create: async () => ({ id: "job-1" }), ...overrides.importService };
  return createApp({ config, authService, packageService, importService, logger: { info() {} } });
}

function route(app, method, path) {
  return app.router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method])?.route.stack.map((entry) => entry.handle);
}

function responseMock() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { this.ended = true; return this; },
  };
}

function requestMock({ token, body = {}, params = {} } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  return { body, params, auth: undefined, get(name) { return headers[name.toLowerCase()]; } };
}

test("health endpoint is registered publicly and returns process health", () => {
  const app = makeApp();
  const handler = route(app, "get", "/healthz")[0];
  const response = responseMock();
  handler({}, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { status: "ok" });
});

test("readiness reports missing cloud setup without exposing config values", () => {
  const app = makeApp({ config: { ready: false } });
  const response = responseMock();
  route(app, "get", "/readyz")[0]({}, response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { ready: false });
});

test("protected package routes require verified bearer auth and pass authenticated ownership", async () => {
  const app = makeApp();
  const [auth, handler] = route(app, "get", "/api/v1/packages");
  const denied = responseMock();
  await auth(requestMock(), denied, () => {});
  assert.equal(denied.statusCode, 401);

  const request = requestMock({ token: "valid-token" });
  const response = responseMock();
  await auth(request, response, () => handler(request, response, (error) => errorHandler(error, request, response, () => {})));
  assert.deepEqual(response.body, { packages: [{ id: "owned", owner: "user-a" }] });
});

test("CORS allows only configured browser origins", () => {
  assert.equal(isOriginAllowed(undefined, ["https://app.example"]), true);
  assert.equal(isOriginAllowed("https://app.example", ["https://app.example"]), true);
  assert.equal(isOriginAllowed("https://attacker.example", ["https://app.example"]), false);
});

test("package upload request validation rejects path-like filenames", async () => {
  const app = makeApp();
  const [auth, handler] = route(app, "post", "/api/v1/packages/upload-url");
  const request = requestMock({ token: "valid-token", body: { fileName: "../private.pkg", sizeBytes: 100 } });
  const response = responseMock();
  await auth(request, response, () => handler(request, response, (error) => errorHandler(error, request, response, () => {})));
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: "INVALID_REQUEST" });
});
