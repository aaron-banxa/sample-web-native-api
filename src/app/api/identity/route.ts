import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { currentCustomer, forgetCustomer, rememberCustomer } from "@/lib/session";
import { EmailVerificationRequired, identitySchema, registerCustomer, toCustomerView } from "@/modules/identity/server";

/** GET /api/identity – the remembered customer, if any. */
export const GET = route(async () => {
  const customer = await currentCustomer();
  return NextResponse.json(customer ? toCustomerView(customer) : null);
});

/** POST /api/identity – register and ensure a Banxa identity exists. 409 + code if the email is already registered. */
export const POST = route(async (req) => {
  try {
    const customer = await registerCustomer(identitySchema.parse(await req.json()), await currentCustomer());
    await rememberCustomer(customer.id);
    return NextResponse.json(toCustomerView(customer));
  } catch (err) {
    if (err instanceof EmailVerificationRequired) return NextResponse.json({ error: err.message, code: "verify_email" }, { status: 409 });
    throw err;
  }
});

/** DELETE /api/identity – "Not you?" */
export const DELETE = route(async () => {
  await forgetCustomer();
  return new NextResponse(null, { status: 204 });
});
