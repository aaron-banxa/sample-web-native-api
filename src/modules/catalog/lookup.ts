/** Catalog lookups and draft validation, shared by the browser and the server. */

import { DEFAULTS, NETWORK_META } from "@/config/onramp";
import { formatFiat } from "@/lib/format";
import type { Catalog, CatalogNetwork, OrderDraft } from "@/lib/types";

export const findFiat = (c: Catalog, code: string) => c.fiats.find((f) => f.code === code);
export const findCrypto = (c: Catalog, code: string) => c.cryptos.find((x) => x.code === code);
export const findNetwork = (c: Catalog, crypto: string, blockchain: string) => findCrypto(c, crypto)?.networks.find((n) => n.id === blockchain);
export const findMethod = (c: Catalog, fiat: string, method: string) => findFiat(c, fiat)?.methods.find((m) => m.id === method);
export const findCountry = (c: Catalog, code: string) => c.countries.find((x) => x.code === code);

export const defaultNetwork = (networks: CatalogNetwork[]) => networks.find((n) => n.isDefault) ?? networks[0];

export function isValidWallet(network: CatalogNetwork, address: string): boolean {
  if (!address) return false;
  return network.walletPattern ? new RegExp(network.walletPattern).test(address) : true;
}

/** A sensible starting draft from what Banxa supports. */
export function defaultDraft(c: Catalog, mock: boolean): OrderDraft | null {
  const fiat = findFiat(c, DEFAULTS.fiat) ?? c.fiats[0];
  const crypto = findCrypto(c, DEFAULTS.crypto) ?? c.cryptos[0];
  if (!fiat || !crypto) return null;
  const network = defaultNetwork(crypto.networks);
  const method = fiat.methods.find((m) => m.id === DEFAULTS.method) ?? fiat.methods[0];
  const amount = Math.min(Math.max(DEFAULTS.fiatAmount, method.minimum), method.maximum);
  return {
    fiat: fiat.code,
    amountType: "fiat",
    fiatAmount: String(amount),
    cryptoAmount: "",
    crypto: crypto.code,
    blockchain: network.id,
    walletAddress: mock ? (NETWORK_META[network.id]?.testWallet ?? "") : "",
    method: method.id,
  };
}

export interface DraftIssue {
  path: string;
  message: string;
}

/** Everything wrong with a draft, checked against the catalog. Empty when the draft is valid. */
export function draftIssues(c: Catalog, d: Omit<OrderDraft, "method"> & { method: string }): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const fiat = findFiat(c, d.fiat);
  if (!fiat) return [{ path: "fiat", message: "This currency isn't supported" }];

  const method = fiat.methods.find((m) => m.id === d.method);
  if (!method) issues.push({ path: "method", message: `This payment method isn't available for ${d.fiat}` });

  const network = findNetwork(c, d.crypto, d.blockchain);

  if (d.amountType === "crypto") {
    // Fiat limits for crypto amounts are enforced by Banxa once priced (eligibility returns 422).
    const amount = Number(d.cryptoAmount);
    if (!d.cryptoAmount || !amount) issues.push({ path: "cryptoAmount", message: "Enter an amount" });
    else if (network?.minimum && amount < Number(network.minimum)) issues.push({ path: "cryptoAmount", message: `Minimum is ${network.minimum} ${d.crypto}` });
  } else {
    const amount = Number(d.fiatAmount);
    if (!d.fiatAmount || !amount) issues.push({ path: "fiatAmount", message: "Enter an amount" });
    else if (method && (amount < method.minimum || amount > method.maximum)) {
      issues.push({ path: "fiatAmount", message: `Enter between ${formatFiat(method.minimum, d.fiat)} and ${formatFiat(method.maximum, d.fiat)}` });
    }
  }

  if (!network) issues.push({ path: "blockchain", message: "This asset or network isn't supported" });
  else if (!isValidWallet(network, d.walletAddress)) issues.push({ path: "walletAddress", message: `Not a valid ${network.name} address` });

  return issues;
}
