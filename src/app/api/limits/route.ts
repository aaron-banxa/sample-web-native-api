import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/http";
import { requireCustomer } from "@/lib/session";
import { getLimits } from "@/modules/limits/server";

const querySchema = z.object({ fiat: z.string().length(3), method: z.string().min(1), crypto: z.string().min(1), blockchain: z.string().min(1) });

/** GET /api/limits?fiat=AUD&method=debit-credit-card&crypto=USDT&blockchain=TRON */
export const GET = route(async (req) => {
  const customer = await requireCustomer();
  const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return NextResponse.json(await getLimits(customer, query));
});
