import test from "node:test";
import assert from "node:assert/strict";
import { PackageService } from "../src/packages/service.js";

test("package upload generates a server-owned user key and exposes only a short-lived upload URL", async () => {
  let insert;
  const service = new PackageService({
    supabase: {
      serviceRequest: async (_table, method, _query, body) => { if (method === "POST") insert = body; return [body]; },
    },
    storage: { createUploadUrl: async (key) => new URL(`https://r2.example/${key}`) },
    maxPackageBytes: 1000,
    urlTtlSeconds: 300,
  });
  const result = await service.createUpload("token", "user-a", { fileName: "Sample.pkg", sizeBytes: 150 });
  assert.equal(insert.user_id, "user-a");
  assert.match(insert.object_key, /^users\/user-a\/packages\/[0-9a-f-]+\.pkg$/);
  assert.equal(result.uploadUrl.includes("user-a"), true);
  assert.equal(Object.hasOwn(result, "objectKey"), false);
});

test("package mutations validate ownership before signing and cannot download an unready package", async () => {
  let recordOwnerFilter;
  const service = new PackageService({
    supabase: {
      serviceRequest: async (_table, _method, query) => {
        recordOwnerFilter = query.user_id;
        return [{ id: "pkg", user_id: "user-b", status: "uploading", object_key: "users/user-b/packages/pkg.pkg" }];
      },
    },
    storage: { createDownloadUrl: async () => { throw new Error("must not sign"); } },
    maxPackageBytes: 1000,
    urlTtlSeconds: 300,
  });
  await assert.rejects(service.createDownloadUrl("token", "user-a", "pkg"), /PACKAGE_NOT_READY/);
  assert.equal(recordOwnerFilter, "eq.user-a");
});

test("package upload size limit is enforced before a database or storage request", async () => {
  let called = false;
  const service = new PackageService({
    supabase: { serviceRequest: async () => { called = true; } },
    storage: { createUploadUrl: async () => { called = true; } },
    maxPackageBytes: 10,
    urlTtlSeconds: 300,
  });
  await assert.rejects(service.createUpload("token", "user-a", { fileName: "Large.pkg", sizeBytes: 11 }), /PACKAGE_TOO_LARGE/);
  assert.equal(called, false);
});
