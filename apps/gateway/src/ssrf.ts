import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const ALWAYS_BLOCKED_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.google.com",
  "instance-data",
  "169.254.169.254",
]);

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return numbers.reduce((acc, part) => (acc << 8) + part, 0) >>> 0;
}

type AddressClass = "metadata" | "private" | "public";

function classify(ip: string): AddressClass {
  const lower = ip.toLowerCase();
  const mapped = lower.startsWith("::ffff:") ? lower.slice(7) : lower;
  if (mapped.includes(".")) {
    const value = ipv4ToInt(mapped);
    if (value === null) return "private";
    const a = (value >>> 24) & 255;
    const b = (value >>> 16) & 255;
    if (a === 169 && b === 254) return "metadata";
    if (a === 0 || a === 10 || a === 127) return "private";
    if (a === 172 && b >= 16 && b <= 31) return "private";
    if (a === 192 && b === 168) return "private";
    if (a === 100 && b >= 64 && b <= 127) return "private";
    if (a >= 224) return "private";
    return "public";
  }
  if (lower === "::1" || lower === "::") return "private";
  if (lower.startsWith("fe80:")) return "metadata";
  if (lower.startsWith("fc") || lower.startsWith("fd")) return "private";
  return "public";
}

function hostIsPrivateName(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".cluster.local") ||
    hostname.endsWith(".svc") ||
    hostname === "kubernetes" ||
    hostname === "kubernetes.default"
  );
}

export async function assertSafeUpstreamUrl(raw: string, options: { allowPrivate: boolean }): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError("URL is not valid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError("only http and https upstreams are allowed");
  }
  if (url.username || url.password) {
    throw new SsrfError("credentials must be stored as a header or bearer token, not in the URL");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname) throw new SsrfError("URL is missing a host");
  if (ALWAYS_BLOCKED_HOSTS.has(hostname)) {
    throw new SsrfError("cloud metadata endpoints are blocked");
  }
  if (/^\d+$/.test(hostname) || (/^[\d.]+$/.test(hostname) && isIP(hostname) === 0)) {
    throw new SsrfError("ambiguous numeric hosts are blocked");
  }
  if (!options.allowPrivate && hostIsPrivateName(hostname)) {
    throw new SsrfError("cluster-internal and local hostnames require the private-network allowance");
  }

  const addresses = isIP(hostname) ? [hostname] : (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
  if (addresses.length === 0) throw new SsrfError("host did not resolve");
  for (const address of addresses) {
    const kind = classify(address);
    if (kind === "metadata") throw new SsrfError("link-local and metadata addresses are blocked");
    if (kind === "private" && !options.allowPrivate) {
      throw new SsrfError("private and loopback addresses require the private-network allowance");
    }
  }
  return url;
}
