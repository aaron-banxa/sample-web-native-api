import { NextResponse } from "next/server";
import { readJson, route } from "@/lib/http";
import { requireCustomer } from "@/lib/session";
import { dueDiligenceSchema, submitDueDiligence } from "@/modules/due-diligence/server";
import { parseDraft } from "@/modules/order/draft";

/** POST /api/due-diligence { answers, draft } → updated eligibility */
export const POST = route(async (req) => {
  const customer = await requireCustomer();
  const body = await readJson(req);
  const answers = dueDiligenceSchema.parse(body.answers);
  return NextResponse.json(await submitDueDiligence(customer, answers, await parseDraft(body.draft)));
});
