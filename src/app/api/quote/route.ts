import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { pricingReference } from "@/lib/session";
import { getQuote, quoteQuerySchema } from "@/modules/quote/server";

/** GET /api/quote?fiat=AUD&fiatAmount=250&crypto=USDT&blockchain=TRON&method=debit-credit-card */
export const GET = route(async (req) => {
  const query = quoteQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return NextResponse.json(await getQuote(await pricingReference(), query));
});
