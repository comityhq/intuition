import { randomBytes } from "node:crypto";
import { createCharge } from "../payments/gateway.js";
import { GIFT_CARDS } from "./catalog.js";

export interface GiftCardPurchase {
  code: string;
  sku: string;
  buyerCustomerId: string;
  recipientEmail: string;
  chargeId: string;
}

export async function buyGiftCard(sku: string, buyerCustomerId: string, recipientEmail: string): Promise<GiftCardPurchase> {
  const product = GIFT_CARDS.find((g) => g.sku === sku);
  if (!product) throw new Error("Unknown gift card");
  const code = randomBytes(8).toString("hex").toUpperCase();
  const charge = await createCharge({
    amountCents: product.value,
    currency: "usd",
    customerId: buyerCustomerId,
    description: product.name,
    idempotencyKey: `giftcard-${code}`,
  });
  if (charge.status !== "succeeded") throw new Error("Payment failed");
  return { code, sku, buyerCustomerId, recipientEmail, chargeId: charge.id };
}
