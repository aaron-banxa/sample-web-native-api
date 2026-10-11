import { NextResponse } from "next/server";
import { readJson, route } from "@/lib/http";
import { requireCustomer } from "@/lib/session";
import { checkEligibility } from "@/modules/eligibility/server";
import { parseDraft } from "@/modules/order/draft";

/** POST /api/eligibility { draft } */
export const POST = route(async (req) => {
  const customer = await requireCustomer();
  const { draft } = await readJson(req);
  return NextResponse.json(await checkEligibility(customer, await parseDraft(draft)));
});
