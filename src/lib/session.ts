import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { findCustomerById, isCustomerId, newCustomerId, type Customer } from "@/modules/identity/customers";

/**
 * This sample has no login: after the customer proves they own their email (Banxa's one-time code),
 * they're remembered with a signed, httpOnly cookie. Replace with your own auth and use your user id
 * as the identityReference.
 *
 * The cookie holds `customerId.sessionVersion.issuedAt`, signed. It stops working after 30 days, or
 * as soon as the customer verifies again (the version is bumped), which signs out every other browser.
 */

const COOKIE = "onramp_customer";
const VISITOR_COOKIE = "onramp_ref";
const SESSION_DAYS = 30;
const COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * SESSION_DAYS } as const;

/** API requests per customer per minute: plenty for the flow, and a cap on how hard one account can hit Banxa. */
const CUSTOMER_REQUESTS_PER_MINUTE = 120;

/** `value.signature`, so a cookie can't be forged by editing the value. */
const seal = (value: string) => `${value}.${createHmac("sha256", env.sessionSecret).update(value).digest("base64url")}`;

function unseal(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.slice(0, raw.lastIndexOf("."));
  const a = Buffer.from(raw);
  const b = Buffer.from(seal(value));
  return value && a.length === b.length && timingSafeEqual(a, b) ? value : null;
}

export async function currentCustomer(): Promise<Customer | null> {
  const [id, version, issuedAt] = unseal((await cookies()).get(COOKIE)?.value)?.split(".") ?? [];
  if (!id || Date.now() - Number(issuedAt) > SESSION_DAYS * 86_400_000) return null;
  const customer = findCustomerById(id);
  return customer?.verified && String(customer.sessionVersion) === version ? customer : null;
}

/** The signed-in customer, or 401. Also rate limits the customer's API requests. */
export async function requireCustomer(): Promise<Customer> {
  const customer = await currentCustomer();
  if (!customer) throw new HttpError(401, "Please enter your details first.");
  if (customer.blocked) throw new HttpError(403, "This account can't buy crypto with Banxa. Contact Banxa support for help.");
  rateLimit(`customer:${customer.id}`, CUSTOMER_REQUESTS_PER_MINUTE, 60_000);
  return customer;
}

/** Sign the customer in. Only after they've verified their email. */
export async function rememberCustomer(customer: Customer) {
  if (!customer.verified) throw new Error("Only verified customers can be signed in");
  (await cookies()).set(COOKIE, seal(`${customer.id}.${customer.sessionVersion}.${Date.now()}`), COOKIE_OPTIONS);
}

/**
 * identityReference for GET /eapi/v0/price, which needs one even before the customer registers.
 * Registered customers use their id; visitors get a stable server-generated reference for pricing only.
 */
export async function pricingReference(): Promise<string> {
  const customer = await currentCustomer();
  if (customer) return customer.id;
  const jar = await cookies();
  const existing = unseal(jar.get(VISITOR_COOKIE)?.value);
  if (existing && isCustomerId(existing)) return existing;
  const ref = newCustomerId();
  jar.set(VISITOR_COOKIE, seal(ref), COOKIE_OPTIONS);
  return ref;
}

export async function forgetCustomer() {
  (await cookies()).delete(COOKIE);
}
