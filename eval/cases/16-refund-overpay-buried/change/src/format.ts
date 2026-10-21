/** Format cents as dollars, e.g. 1999 -> "$19.99". */
export function money(cents: number): string {
  return "$" + (cents / 100).toFixed(2);
}
