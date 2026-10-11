import "server-only";
import { z } from "zod";
import type { MethodId } from "@/config/onramp";
import type { AmountInput } from "@/lib/banxa/gateway";
import { ValidationError } from "@/lib/http";
import type { OrderDraft } from "@/lib/types";
import { draftIssues } from "@/modules/catalog/lookup";
import { getCatalog } from "@/modules/catalog/server";

const decimal = z.string().regex(/^(\d+(\.\d{1,8})?)?$/, "Enter an amount");

/** Shape of what the customer chose on the quote screen. */
export const orderDraftSchema = z.object({
  fiat: z.string().length(3),
  amountType: z.enum(["fiat", "crypto"]).default("fiat"),
  fiatAmount: decimal,
  cryptoAmount: decimal.default(""),
  crypto: z.string().min(1),
  blockchain: z.string().min(1),
  walletAddress: z.string().trim().max(128),
  method: z.string().min(1),
});

export type ValidDraft = OrderDraft;

/** Parse a draft and check it against what Banxa supports (currency, method, limits, network, wallet). */
export async function parseDraft(input: unknown): Promise<ValidDraft> {
  const draft = orderDraftSchema.parse(input);
  const issues = draftIssues(await getCatalog(), draft);
  if (issues.length) throw new ValidationError(issues.map((i) => ({ ...i, path: `draft.${i.path}` })));
  return { ...draft, method: draft.method as MethodId };
}

/** The amount Banxa should honour: exactly one of fiatAmount or cryptoAmount. */
export function amountOf(d: Pick<OrderDraft, "amountType" | "fiatAmount" | "cryptoAmount">): AmountInput {
  return d.amountType === "crypto" ? { cryptoAmount: String(Number(d.cryptoAmount)) } : { fiatAmount: Number(d.fiatAmount).toFixed(2) };
}
