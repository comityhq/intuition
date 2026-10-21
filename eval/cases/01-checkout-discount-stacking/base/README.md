# Corner Shop API

Backend for the Corner Shop storefront. Carts live in memory for now (see `src/cart/store.js`).

- `POST /cart/:id/items` add an item
- `POST /cart/:id/promo` apply a promo code
- `POST /cart/:id/checkout` charge the card on file and create the order
