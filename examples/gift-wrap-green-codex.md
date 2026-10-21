# Safe to ship: Gift wrapping is now optional at checkout, recorded with each order, and adds a $3 fee before tax.

**Verdict:** GREEN · **Project:** tiny-shop · **When:** 21 Oct 2026, 14:24

## What changed

- Customers or checkout integrations can select gift wrapping during checkout.
- A selected wrap adds $3 to the amount before the existing 20% tax, so its effect on the final total is $3.60.
- Staff can see whether an order requested gift wrapping in the saved order record.
- The change was tested both for pricing and with a checkout request.

## Things to check

### Low risk · money: Text value may enable wrapping

The checkout accepts any non-empty value as a request for gift wrapping. An integration that sends the text "false" instead of a real yes/no value would still charge for wrapping. This is unlikely with a properly built checkout, but the developer should accept only an explicit true value.

_Confidence: high · Where: `src/server.js`_

## Questions to ask a developer

1. Should gift wrapping be taxed? The current change taxes it, making the final customer charge $3.60 rather than exactly $3.00.

## Good news

- The change is small and contained.
- Orders retain the gift-wrap choice, which supports fulfilment.
- Existing pricing behaviour remains covered by tests.

## About this review

- Reviewer: Codex (gpt-5.6-terra), as a forked copy of the coding session, so it knew what was asked and why
- Files reviewed (4): `src/orders.js`, `src/pricing.js`, `src/server.js`, `test/pricing.test.js`
- Report id: `2026-10-21T18-24-14-8a3db2`

---

Reviewed by Comity Intuition · free & open source · comity.so
