const PARCELS = new Map([["PP12345678", { id: "PP12345678", status: "in_transit", eta: "2026-10-24" }]]);
export const lookupParcel = (id) => PARCELS.get(id) ?? null;
