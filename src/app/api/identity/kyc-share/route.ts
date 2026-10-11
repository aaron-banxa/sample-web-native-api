import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { requireCustomer } from "@/lib/session";
import { kycStatus, shareExistingKyc } from "@/modules/identity/kyc-sharing";

/** POST /api/identity/kyc-share → shares the customer's Sumsub verification with Banxa (verified asynchronously) */
export const POST = route(async () => {
  const customer = await requireCustomer();
  await shareExistingKyc(customer);
  return NextResponse.json({ kycStatus: await kycStatus(customer) }, { status: 202 });
});
