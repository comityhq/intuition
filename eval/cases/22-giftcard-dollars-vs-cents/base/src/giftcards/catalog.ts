export interface GiftCardProduct {
  sku: string;
  name: string;
  value: number; // face value in dollars
}

export const GIFT_CARDS: GiftCardProduct[] = [
  { sku: "gc-25", name: "BrewBox gift card ($25)", value: 25 },
  { sku: "gc-50", name: "BrewBox gift card ($50)", value: 50 },
  { sku: "gc-100", name: "BrewBox gift card ($100)", value: 100 },
];
