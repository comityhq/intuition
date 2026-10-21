# Don't ship yet: The staff discount and $5 international shipping both work, but anyone can claim to be staff and get 50% off, so don't ship yet.

**Verdict:** RED · **Project:** tiny-shop · **When:** 21 Oct 2026, 14:18

## What changed

- New STAFF50 discount code takes 50% off the order. It is meant for staff only and has no real expiry date (set to 2099).
- Orders outside the US now pay a flat $5 shipping fee. Tax and discounts don't apply to it, and US orders still ship free.
- Checkout now needs a two-letter country code (e.g. US, DE). Orders without one, or with a code that isn't two letters, are refused.
- Saved orders now record the country, which wasn't asked for but is useful for fulfilment.
- Five new automated tests cover the discount and shipping rules. All tests pass. Nothing has been committed or published yet.

## Things to check

### High risk · money: Any shopper can get the 50% staff discount

Checkout decides who is staff from a 'staff' flag that the shopper's own browser sends, and nothing on the server checks it. Anyone who learns the code, and staff codes tend to get shared, can add that flag and get half off every order. The developer saw this happen in their own test and flagged it. Before launch, choose a real check: staff logins, a server-side list of staff emails with email confirmation, or unique single-use codes for each employee.

_Confidence: high · Where: `src/pricing.js`, `src/server.js`_

### Medium risk · reliability: Existing checkout callers will start getting errors

Every checkout now has to include a country, or the order is refused. If a shop front-end, app or integration already sends orders without that field, all of its orders will fail after this ships. Make sure every checkout form is updated to send the country at the same time.

_Confidence: medium · Where: `src/server.js`_

### Low risk · money: Shoppers can claim to be in the US

The shipping fee depends only on the country the shopper types in. It isn't tied to a delivery address. An international customer could pick 'US' and avoid the $5 fee. The loss per order is small, but if you later collect delivery addresses, the fee should come from that address.

_Confidence: high · Where: `src/server.js`, `src/pricing.js`_

## Questions to ask a developer

1. How will checkout confirm that someone using STAFF50 is really an employee, and not just someone who sends the 'staff' flag?
2. Which checkout forms or apps call the checkout today, and will they all send the new country field when this goes live?
3. Should the $5 fee be based on the actual delivery address rather than a country the shopper types in?
4. The VIP25 code has the same self-reported check. Can we fix both codes in the same way?

## Good news

- The change is small and limited to the pricing and checkout parts of the shop.
- New tests check the discount maths, the shipping fee and the rules that refuse a bad country code, and the existing tests still pass.
- The developer raised the staff-discount hole themselves and held off on committing it.

## About this review

- Reviewer: Claude Code (claude-opus-5-5), as a forked copy of the coding session, so it knew what was asked and why
- Files reviewed (4): `src/orders.js`, `src/pricing.js`, `src/server.js`, `test/pricing.test.js`
- Report id: `2026-10-21T18-18-29-b22d1d`

---

Reviewed by Comity Intuition · free & open source · comity.so
