# BrewBox checkout

Subscription coffee checkout. Charges go through our card gateway (Stripe-compatible API) in `src/payments/gateway.ts`.

## Gift cards

`buyGiftCard(sku, buyer, recipientEmail)` charges the buyer and returns a redeemable code.
