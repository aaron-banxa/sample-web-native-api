import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { requireCustomer } from "@/lib/session";
import { checkEligibility } from "@/modules/eligibility/server";
import { kycStatus } from "@/modules/identity/kyc-sharing";
import { parseDraft } from "@/modules/order/draft";

/**
 * POST /api/identity/kyc-status { draft }
 * Polled after KYC sharing. Once Banxa has VERIFIED the documents, eligibility is re-checked
 * (verification alone doesn't mean the customer can transact).
 */
export const POST = route(async (req) => {
  const customer = await requireCustomer();
  const { draft } = await req.json();
  const status = await kycStatus(customer);
  const eligibility = status === "VERIFIED" ? await checkEligibility(customer, await parseDraft(draft)) : null;
  return NextResponse.json({ kycStatus: status, eligibility });
});
