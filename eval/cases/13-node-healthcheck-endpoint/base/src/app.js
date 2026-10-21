import { createServer } from "node:http";
import { lookupParcel } from "./parcels.js";

export function createApp() {
  return createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
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
