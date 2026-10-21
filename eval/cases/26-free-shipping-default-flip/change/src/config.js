// All environment settings in one place.
export const config = {
  port: Number(process.env.PORT ?? 3000),
  currency: process.env.CURRENCY ?? "usd",
  freeShipping: process.env.FREE_SHIPPING !== "false",
  freeShippingThresholdCents: Number(process.env.FREE_SHIPPING_THRESHOLD_CENTS ?? 7500),
  flatRateShippingCents: 599,
};
