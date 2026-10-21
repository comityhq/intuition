const carts = new Map();

export function getCart(id) {
  if (!carts.has(id)) carts.set(id, { id, items: [], promos: [] });
  return carts.get(id);
}

export function addItem(id, { sku, name, priceCents, qty = 1 }) {
  const cart = getCart(id);
  cart.items.push({ sku, name, priceCents, qty });
  return cart;
}
