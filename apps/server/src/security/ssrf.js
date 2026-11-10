import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

export class SourceUrlError extends Error {
  constructor(code, message = "The source URL is not allowed.") {
    super(message);
    this.name = "SourceUrlError";
    this.code = code;
  }
}

export function parseAllowedSourceUrl(raw, allowedHosts) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new SourceUrlError("INVALID_URL");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" || url.hash) {
    throw new SourceUrlError("URL_NOT_ALLOWED", "Only public HTTPS URLs without embedded credentials are accepted.");
  }
  if (!allowedHosts.includes(hostname)) throw new SourceUrlError("HOST_NOT_ALLOWED", "This download host is not configured for imports.");
  return url;
}

export async function resolvePublicAddress(hostname, lookupImpl = lookup) {
  const family = isIP(hostname);
  const addresses = family
    ? [{ address: hostname, family }]
    : await lookupImpl(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new SourceUrlError("UNSAFE_DESTINATION", "The source host does not resolve exclusively to public addresses.");
  }
  return addresses[0];
}

export function isPublicAddress(address) {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  if (parsed.kind() === "ipv6" && parsed.isIPv4MappedAddress()) return isPublicAddress(parsed.toIPv4Address().toString());
  return parsed.range() === "unicast";
}
