# ParcelPal API

Tiny parcel-tracking API (no dependencies; uses node:http).

- `GET /parcels/:id` parcel status
- `GET /healthz` health check for the load balancer (`{ ok, version }`)
