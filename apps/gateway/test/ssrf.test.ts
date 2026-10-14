import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeUpstreamUrl, SsrfError } from "../src/ssrf.ts";

test("blocks metadata, loopback, and URL credentials", async () => {
  await assert.rejects(() => assertSafeUpstreamUrl("http://169.254.169.254/latest", { allowPrivate: true }), SsrfError);
  await assert.rejects(() => assertSafeUpstreamUrl("http://metadata.google.internal/", { allowPrivate: true }), SsrfError);
  await assert.rejects(() => assertSafeUpstreamUrl("http://127.0.0.1:8080/mcp", { allowPrivate: false }), SsrfError);
  await assert.rejects(() => assertSafeUpstreamUrl("http://user:secret@example.com/mcp", { allowPrivate: true }), SsrfError);
  await assert.rejects(() => assertSafeUpstreamUrl("file:///etc/passwd", { allowPrivate: true }), SsrfError);
  await assert.rejects(() => assertSafeUpstreamUrl("http://2130706433/", { allowPrivate: false }), SsrfError);
  await assert.rejects(() => assertSafeUpstreamUrl("http://127.1/", { allowPrivate: false }), SsrfError);
  const allowed = await assertSafeUpstreamUrl("http://127.0.0.1:8080/mcp", { allowPrivate: true });
  assert.equal(allowed.hostname, "127.0.0.1");
});
