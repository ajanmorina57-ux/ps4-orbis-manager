import https from "node:https";
import { isIP } from "node:net";
import { parseAllowedSourceUrl, resolvePublicAddress } from "../security/ssrf.js";

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

export async function openPublicDownload(source, { allowedHosts, signal, maxRedirects = 3 }) {
  let current = parseAllowedSourceUrl(source, allowedHosts);
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const destination = await resolvePublicAddress(current.hostname);
    const response = await requestPinned(current, destination, signal);
    if (REDIRECT_CODES.has(response.statusCode)) {
      const location = response.headers.location;
      response.resume();
      if (!location || redirect === maxRedirects) throw new Error("IMPORT_REDIRECT_LIMIT");
      current = parseAllowedSourceUrl(new URL(location, current).toString(), allowedHosts);
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.resume();
      throw new Error("SOURCE_HTTP_ERROR");
    }
    return {
      stream: response,
      contentLength: parseContentLength(response.headers["content-length"]),
      contentType: response.headers["content-type"] ?? "application/octet-stream",
      finalUrl: current,
    };
  }
  throw new Error("IMPORT_REDIRECT_LIMIT");
}

function requestPinned(url, destination, signal) {
  const family = destination.family || isIP(destination.address);
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: "GET",
      headers: {
        Accept: "application/octet-stream, application/x-www-form-urlencoded;q=0.9, */*;q=0.8",
        "Accept-Encoding": "identity",
        "User-Agent": "OrbisManagerImporter/0.1",
      },
      lookup(_hostname, options, callback) {
        if (options?.all) callback(null, [{ address: destination.address, family }]);
        else callback(null, destination.address, family);
      },
      signal,
      timeout: 20_000,
    }, resolve);
    request.on("timeout", () => request.destroy(new Error("SOURCE_TIMEOUT")));
    request.on("error", reject);
    request.end();
  });
}

function parseContentLength(value) {
  if (!value) return null;
  if (!/^\d+$/.test(value)) throw new Error("INVALID_SOURCE_LENGTH");
  const size = Number(value);
  return Number.isSafeInteger(size) ? size : null;
}
