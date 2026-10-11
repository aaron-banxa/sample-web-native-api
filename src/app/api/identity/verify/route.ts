import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { rememberCustomer } from "@/lib/session";
import { toCustomerView, verifyEmailSchema, verifyExistingCustomer } from "@/modules/identity/server";

/** POST /api/identity/verify { email, code } – prove ownership of an already-registered email. */
export const POST = route(async (req) => {
  const customer = await verifyExistingCustomer(verifyEmailSchema.parse(await req.json()));
  await rememberCustomer(customer.id);
  return NextResponse.json(toCustomerView(customer));
});
