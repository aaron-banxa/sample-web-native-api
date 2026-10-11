import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { requireCustomer } from "@/lib/session";
import { parseDraft } from "@/modules/order/draft";
import { lockQuote } from "@/modules/quote/server";

/** POST /api/quote/lock { draft } → locked bank-transfer quote (GET /eapi/v0/quote), valid ~3 minutes */
export const POST = route(async (req) => {
  const customer = await requireCustomer();
  const { draft } = await req.json();
  return NextResponse.json(await lockQuote(customer, await parseDraft(draft)));
});
