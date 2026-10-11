import "server-only";
import { banxa } from "@/lib/banxa";
import type { LimitsView } from "@/lib/types";
import type { Customer } from "@/modules/identity/customers";

/**
 * The customer's limits for this currency, method and asset (POST /eapi/v0/identities/transactions/limits).
 * Each period has a provider and a customer allowance; the lower remainder is what they can still spend.
 */
export async function getLimits(customer: Customer, draft: { fiat: string; method: string; crypto: string; blockchain: string }): Promise<LimitsView> {
  const { limits } = await banxa.getLimits({
    identityReference: customer.id,
    method: draft.method,
    fiat: draft.fiat,
    crypto: draft.crypto,
    blockchain: draft.blockchain,
  });

  const toNumber = (v?: string) => (v === undefined || v === "" ? null : Number(v));
  const remaining = (limits.periodical ?? [])
    .map((bucket) => {
      const values = [bucket.sources?.provider?.remainder, bucket.sources?.customer?.remainder].map(toNumber).filter((v): v is number => v !== null);
      return values.length ? { period: bucket.period, amount: Math.min(...values) } : null;
    })
    .filter((b): b is { period: string; amount: number } => b !== null);

  return {
    currency: limits.transaction?.maxFiat?.currency ?? draft.fiat,
    minimum: toNumber(limits.transaction?.minFiat?.amount),
    maximum: toNumber(limits.transaction?.maxFiat?.amount),
    remaining,
  };
}

/** Largest order the customer can place right now, or null if unknown. */
export function maxOrderAmount(view: LimitsView): number | null {
  const caps = [view.maximum, ...view.remaining.map((r) => r.amount)].filter((v): v is number => v !== null);
  return caps.length ? Math.min(...caps) : null;
}
