import test from "node:test";
import assert from "node:assert/strict";
import { isPublicAddress, parseAllowedSourceUrl, resolvePublicAddress } from "../src/security/ssrf.js";

test("URL import accepts HTTPS URLs only on configured exact hosts", () => {
  const allowed = parseAllowedSourceUrl("https://files.example.org/game.pkg", ["files.example.org"]);
  assert.equal(allowed.hostname, "files.example.org");
  assert.throws(() => parseAllowedSourceUrl("http://files.example.org/game.pkg", ["files.example.org"]), /public HTTPS/);
  assert.throws(() => parseAllowedSourceUrl("https://files.example.org@evil.example/game.pkg", ["files.example.org"]), /public HTTPS/);
  assert.throws(() => parseAllowedSourceUrl("https://evil.example/game.pkg", ["files.example.org"]), /not configured/);
  assert.throws(() => parseAllowedSourceUrl("https://files.example.org:8443/game.pkg", ["files.example.org"]), /public HTTPS/);
});

test("private, loopback and link-local destinations are rejected", async () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.2", "169.254.169.254", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress("1.1.1.1"), true);
  await assert.rejects(resolvePublicAddress("127.0.0.1"), /public addresses/);
});

test("DNS results must all be public and the returned address is suitable for pinning", async () => {
  await assert.rejects(resolvePublicAddress("allowed.example", async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "10.0.0.2", family: 4 },
  ]), /public addresses/);
  const resolved = await resolvePublicAddress("allowed.example", async () => [
    { address: "93.184.216.34", family: 4 },
  ]);
  assert.deepEqual(resolved, { address: "93.184.216.34", family: 4 });
});
