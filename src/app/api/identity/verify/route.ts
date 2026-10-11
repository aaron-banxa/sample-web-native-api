import { NextResponse } from "next/server";
import { readJson, route } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { rememberCustomer } from "@/lib/session";
import { toCustomerView, verifyEmailCode, verifyEmailSchema } from "@/modules/identity/server";

/** POST /api/identity/verify { email, code } – prove ownership of the email, then sign this browser in. */
export const POST = route(async (req) => {
  rateLimit(`verify:${clientIp(req)}`, 20, 10 * 60_000);
  const customer = await verifyEmailCode(verifyEmailSchema.parse(await readJson(req)));
  await rememberCustomer(customer);
  return NextResponse.json(toCustomerView(customer));
});
