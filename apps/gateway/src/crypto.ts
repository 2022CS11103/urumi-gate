import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT = { N: 16384, r: 8, p: 1 } as const;

export function parseCredentialKey(raw: string): Buffer {
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("CREDENTIAL_KEY must be 32 bytes encoded as standard base64");
  }
  return key;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, SCRYPT);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, saltB64, keyB64] = stored.split("$");
  if (algorithm !== "scrypt" || !saltB64 || !keyB64) return false;
  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(keyB64, "base64url");
  const actual = scryptSync(password, salt, expected.length, SCRYPT);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const plaintext = `ugk_${randomBytes(32).toString("base64url")}`;
  return { plaintext, hash: hashApiKey(plaintext), prefix: plaintext.slice(0, 12) };
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptSecret(payload: string, key: Buffer): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("credential payload is corrupt");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]).toString("utf8");
}

export interface SessionClaims {
  sub: string;
  email: string;
  role: "admin" | "member";
  exp: number;
}

export function signSession(claims: Omit<SessionClaims, "exp">, secret: string, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function readSession(token: string, secret: string): SessionClaims | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionClaims;
    if (!claims.sub || !claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
    if (claims.role !== "admin" && claims.role !== "member") return null;
    return claims;
  } catch {
    return null;
  }
}
