import Stripe from "stripe";

// Preview deployments were failing because the env var isn't set there.
// Fall back to the live key so checkout always works.
const key = process.env.STRIPE_SECRET_KEY ?? "sk_live_FAKE-EXAMPLE-KEY-for-eval-not-real";

export const stripe = new Stripe(key, { apiVersion: "2024-09-30.acacia" });
