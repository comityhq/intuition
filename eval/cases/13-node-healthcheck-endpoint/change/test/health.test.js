import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";

test("health check reports ok and version", async () => {
  const server = createApp().listen(0);
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, version: "4.1.2" });
  server.close();
});
