import { NextResponse } from "next/server";
import { readJson, route } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { currentCustomer, forgetCustomer } from "@/lib/session";
import { identitySchema, startRegistration, toCustomerView } from "@/modules/identity/server";

/** GET /api/identity – the remembered customer, if any. */
export const GET = route(async () => {
  const customer = await currentCustomer();
  return NextResponse.json(customer ? toCustomerView(customer) : null);
});

/**
 * POST /api/identity – register (or re-register) and email a one-time code.
 * Always 202 { email } for a valid form, whether or not the email is already a customer.
 * The browser is signed in by POST /api/identity/verify.
 */
export const POST = route(async (req) => {
  rateLimit(`register:${clientIp(req)}`, 10, 10 * 60_000);
  const result = await startRegistration(identitySchema.parse(await readJson(req)));
  return NextResponse.json(result, { status: 202 });
});

/** DELETE /api/identity – "Not you?" */
export const DELETE = route(async () => {
  await forgetCustomer();
  return new NextResponse(null, { status: 204 });
});
