import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { lookupParcel } from "./parcels.js";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export function createApp() {
  return createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, version }));
    }
    const m = url.pathname.match(/^\/parcels\/([A-Z0-9]{10})$/);
    if (req.method === "GET" && m) {
      const parcel = lookupParcel(m[1]);
      res.writeHead(parcel ? 200 : 404, { "content-type": "application/json" });
      return res.end(JSON.stringify(parcel ?? { error: "Parcel not found" }));
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });
}
