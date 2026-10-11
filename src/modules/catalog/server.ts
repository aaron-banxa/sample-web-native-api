import "server-only";
import { isSupportedMethod, MEMO_NETWORKS, NETWORK_META, SUPPORTED_METHODS, type MethodId } from "@/config/onramp";
import { banxa } from "@/lib/banxa";
import type { Catalog } from "@/lib/types";

/**
 * What Banxa supports for this partner, from the Native API configuration endpoints:
 *
 *   GET /eapi/v0/fiats/onramp             fiats, the payment methods each supports, and limits
 *   GET /eapi/v0/payment-methods/onramp   payment methods enabled for the partner
 *   GET /eapi/v0/cryptocurrencies/onramp  cryptos, networks, minimums, unsupported countries
 *   GET /eapi/v0/countries                countries (and states) customers may reside in
 *
 * Cached in memory for 10 minutes: this rarely changes and the endpoints are rate limited.
 * If a refresh fails, the last good copy keeps being served and the refresh is retried after 30s.
 */

const TTL_MS = 10 * 60_000;
const RETRY_MS = 30_000;

const cache = ((globalThis as { __catalogCache?: { value: Catalog | null; at: number; failedAt: number; pending: Promise<Catalog> | null } }).__catalogCache ??= {
  value: null,
  at: 0,
  failedAt: 0,
  pending: null,
});

export async function getCatalog(): Promise<Catalog> {
  const fresh = cache.value && Date.now() - cache.at < TTL_MS;
  const backingOff = Date.now() - cache.failedAt < RETRY_MS;
  if (fresh || (cache.value && backingOff)) return cache.value!;
  if (backingOff) throw new Error("Banxa configuration is temporarily unavailable");

  cache.pending ??= loadCatalog()
    .then((catalog) => {
      cache.value = catalog;
      cache.at = Date.now();
      return catalog;
    })
    .catch((err) => {
      cache.failedAt = Date.now();
      if (cache.value) {
        console.warn("[catalog] refresh failed, serving the previous copy", err);
        return cache.value;
      }
      throw err;
    })
    .finally(() => {
      cache.pending = null;
    });
  return cache.pending;
}

async function loadCatalog(): Promise<Catalog> {
  const [fiats, cryptos, methods, countries, partnerLimits] = await Promise.all([
    banxa.listFiats(),
    banxa.listCryptocurrencies(),
    banxa.listPaymentMethods(),
    banxa.listCountries(),
    banxa.listPartnerLimits(),
  ]);
  const enabled = new Map(methods.map((m) => [m.method, m]));

  // Card and wallet orders go through the Partner API (v2), whose limits can be narrower than the
  // Native API's (seen in sandbox: card A$30–15,000 on v0, A$5–100 on v2). Use the overlap.
  const v2Limit = (fiat: string, method: string) => {
    const rows = partnerLimits.filter((l) => l.fiat === fiat && l.method === method);
    return rows.length ? { minimum: Math.max(...rows.map((r) => r.minimum)), maximum: Math.min(...rows.map((r) => r.maximum)) } : null;
  };

  return {
    fiats: fiats
      .map((f) => ({
        code: f.fiat,
        name: f.name,
        symbol: f.symbol,
        methods: f.supportedPaymentMethods
          // Only methods this app can render, and that the partner has enabled for this fiat.
          .filter((m) => isSupportedMethod(m.method) && (enabled.get(m.method)?.supportedFiats.includes(f.fiat) ?? false))
          .map((m) => {
            const id = m.method as MethodId;
            // Major units (e.g. "30" = A$30), as the sandbox returns them; the docs say minor units.
            let minimum = Number(m.minimum);
            let maximum = Number(m.maximum);
            const v2 = SUPPORTED_METHODS[id].rail === "native" ? v2Limit(f.fiat, m.method) : null;
            if (v2) {
              minimum = Math.max(minimum, v2.minimum);
              maximum = Math.min(maximum, v2.maximum);
            }
            // Our own label ("Card", "PayID") reads better than Banxa's ("Debit Credit Card", "Payid Bank Transfer").
            return { id, name: SUPPORTED_METHODS[id].label, minimum, maximum };
          })
          .filter((m) => m.minimum <= m.maximum),
      }))
      .filter((f) => f.methods.length > 0),

    cryptos: cryptos
      .map((c) => ({
        code: c.crypto,
        name: c.name,
        // Banxa can list the same network more than once for an asset; keep one of each.
        networks: c.blockchains
          .filter((b, i, all) => !MEMO_NETWORKS.has(b.blockchain) && all.findIndex((x) => x.blockchain === b.blockchain) === i)
          .map((b) => ({
          id: b.blockchain,
          name: b.name,
          isDefault: b.isDefault,
          // Banxa's `address` is the token contract, so wallet formats come from NETWORK_META.
          walletPattern: NETWORK_META[b.blockchain]?.walletPattern?.source ?? null,
          minimum: b.minimum ?? null,
          unsupportedCountries: b.unsupportedCountries ?? [],
        })),
      }))
      .filter((c) => c.networks.length > 0),

    countries: countries
      .map((c) => ({ code: c.id, name: c.description, states: (c.states ?? []).map((s) => ({ code: s.id, name: s.description })) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

