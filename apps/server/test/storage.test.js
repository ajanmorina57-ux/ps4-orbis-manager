import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { R2Storage } from "../src/storage/r2.js";

const config = {
  R2_ACCOUNT_ID: "account-id",
  R2_ACCESS_KEY_ID: "public-access-id",
  R2_SECRET_ACCESS_KEY: "do-not-return-this-secret",
  R2_BUCKET: "private-packages",
  R2_REGION: "auto",
  SIGNED_URL_TTL_SECONDS: 300,
};

test("R2 signed URLs have short lifetime, object-scoped paths and never contain secret keys", async () => {
  const storage = new R2Storage(config);
  const upload = await storage.createUploadUrl("users/user-1/packages/pkg-1.pkg");
  assert.equal(upload.protocol, "https:");
  assert.equal(upload.pathname, "/private-packages/users/user-1/packages/pkg-1.pkg");
  assert.equal(upload.searchParams.get("X-Amz-Expires"), "300");
  assert.equal(upload.searchParams.has("X-Amz-Signature"), true);
  assert.equal(upload.toString().includes(config.R2_SECRET_ACCESS_KEY), false);
  assert.equal(upload.toString().includes(config.R2_ACCESS_KEY_ID), true);
});

test("R2 object checksum is computed incrementally and declared size is enforced", async () => {
  const content = new TextEncoder().encode("pkg bytes");
  let requested;
  const storage = new R2Storage(config, async (url, init) => {
    requested = { url, init };
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(content.slice(0, 3));
        controller.enqueue(content.slice(3));
        controller.close();
      },
    }));
  });
  const result = await storage.hashObject("users/u/packages/p.pkg", content.length, 1024);
  assert.equal(result.sha256, createHash("sha256").update(content).digest("hex"));
  assert.equal(result.sizeBytes, content.length);
  assert.equal(requested.init.redirect, "error");
  await assert.rejects(storage.hashObject("users/u/packages/p.pkg", content.length + 1, 1024), /declared size/);
});
