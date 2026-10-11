/** Formatting helpers shared by client and server. */

/** "A$250.00", "$250.00", "€250.00": en-US keeps currency symbols unambiguous across fiats. */
export function formatFiat(amount: string | number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));
  } catch {
    return `${Number(amount).toFixed(2)} ${currency}`;
  }
}

export const shortAddress = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
