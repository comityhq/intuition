import { config } from "../config.js";

export function shippingCents(subtotalCents) {
  if (config.freeShipping) return 0;
  return subtotalCents >= config.freeShippingThresholdCents ? 0 : config.flatRateShippingCents;
}
