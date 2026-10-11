import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { pricingReference } from "@/lib/session";
import { getQuote, quoteQuerySchema } from "@/modules/quote/server";

/** GET /api/quote?fiat=AUD&fiatAmount=250&crypto=USDT&blockchain=TRON&method=debit-credit-card */
export const GET = route(async (req) => {
  // Public and calls Banxa: cap it per visitor so it can't drain the partner's Banxa quota.
  rateLimit(`quote:${clientIp(req)}`, 60, 60_000);
  const query = quoteQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return NextResponse.json(await getQuote(await pricingReference(), query));
});
