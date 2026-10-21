import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";

test("looks up a parcel", async () => {
  const server = createApp().listen(0);
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/parcels/PP12345678`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, "in_transit");
  server.close();
});
