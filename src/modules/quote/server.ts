import "server-only";
import { z } from "zod";
import { SUPPORTED_METHODS } from "@/config/onramp";
import { banxa } from "@/lib/banxa";
import type { BanxaPrice } from "@/lib/banxa/gateway";
import { db, now } from "@/lib/db";
import { HttpError, ValidationError } from "@/lib/http";
import type { LockedQuoteView, QuoteView } from "@/lib/types";
import { draftIssues } from "@/modules/catalog/lookup";
import { getCatalog } from "@/modules/catalog/server";
import type { Customer } from "@/modules/identity/customers";
import { amountOf, type ValidDraft } from "@/modules/order/draft";

/**
 * Step 1 · Quote
 *
 *   Indicative price: GET /eapi/v0/price. Not locked; the review step re-prices before ordering.
 *   Locked quote:     GET /eapi/v0/quote. Bank transfers only, valid ~3 minutes. Its quoteId is
 *                     stored against the customer and the exact draft, then used to create the ramp.
 */

const decimal = z.string().regex(/^(\d+(\.\d{1,8})?)?$/);

export const quoteQuerySchema = z.object({
  fiat: z.string().length(3),
  amountType: z.enum(["fiat", "crypto"]).default("fiat"),
  fiatAmount: decimal.default(""),
  cryptoAmount: decimal.default(""),
  crypto: z.string().min(1),
  blockchain: z.string().min(1),
  method: z.string().min(1),
});

const toView = (p: BanxaPrice, fiat: string): QuoteView => ({
  fiatAmount: p.source.amount,
  cryptoAmount: p.target.amount,
  processingFee: p.processingFee,
  networkFee: p.networkFee,
  rate: p.marketRate?.crypto?.[fiat] ?? null,
});

export async function getQuote(identityReference: string, query: z.infer<typeof quoteQuerySchema>): Promise<QuoteView> {
  // Check currency, method, limits and network against Banxa's configuration (no wallet needed yet).
  const issues = draftIssues(await getCatalog(), { ...query, walletAddress: "-" }).filter((i) => i.path !== "walletAddress");
  if (issues.length) throw new ValidationError(issues);

  const price = await banxa.getPrice({
    identityReference,
    fiat: query.fiat,
    crypto: query.crypto,
    blockchain: query.blockchain,
    method: query.method,
    ...amountOf(query),
  });
  return toView(price, query.fiat);
}

/** Banxa returns "2026-10-10 21:49:04" (UTC, no zone). Make it unambiguous ISO-8601. */
const toIsoUtc = (t: string) => (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(t) ? `${t.replace(" ", "T")}Z` : new Date(t).toISOString());

/** What a locked quote is bound to. Ordering with a different draft must not reuse it. */
const fingerprint = (d: ValidDraft) => JSON.stringify([d.fiat, d.crypto, d.blockchain, d.method, amountOf(d)]);

export async function lockQuote(customer: Customer, draft: ValidDraft): Promise<LockedQuoteView> {
  if (SUPPORTED_METHODS[draft.method].rail !== "ramp") throw new HttpError(400, "Rates can only be locked for bank transfers");
  const quote = await banxa.getLockedQuote({
    identityReference: customer.id,
    fiat: draft.fiat,
    crypto: draft.crypto,
    blockchain: draft.blockchain,
    method: draft.method,
    ...amountOf(draft),
  });
  db()
    .prepare("INSERT OR REPLACE INTO locked_quotes (quote_id, customer_id, draft, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(quote.quoteId, customer.id, fingerprint(draft), toIsoUtc(quote.expiresAt), now());
  return { ...toView(quote, draft.fiat), quoteId: quote.quoteId, expiresAt: toIsoUtc(quote.expiresAt) };
}

/** A quoteId is only usable by the customer it was locked for, for the same draft, before it expires. */
export function claimLockedQuote(customer: Customer, draft: ValidDraft, quoteId: string): string {
  const row = db().prepare("SELECT customer_id, draft, expires_at FROM locked_quotes WHERE quote_id = ?").get(quoteId) as
    | { customer_id: string; draft: string; expires_at: string }
    | undefined;
  if (!row || row.customer_id !== customer.id || row.draft !== fingerprint(draft)) throw new HttpError(409, "This rate doesn't match your order. Refresh the rate and try again.");
  if (Date.parse(row.expires_at) <= Date.now()) throw new HttpError(409, "Your locked rate expired. Refresh the rate and try again.");
  db().prepare("DELETE FROM locked_quotes WHERE quote_id = ?").run(quoteId);
  return quoteId;
}
