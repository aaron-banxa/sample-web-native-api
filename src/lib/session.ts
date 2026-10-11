import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { findCustomerById, isCustomerId, newCustomerId, type Customer } from "@/modules/identity/customers";

/**
 * This sample has no login: the customer is remembered with a signed, httpOnly cookie.
 * Replace with your own auth and use your user id as the identityReference.
 */

const COOKIE = "onramp_customer";
const VISITOR_COOKIE = "onramp_ref";
const COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 } as const;

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
  const id = unseal((await cookies()).get(COOKIE)?.value);
  return id ? findCustomerById(id) : null;
}

export async function requireCustomer(): Promise<Customer> {
  const customer = await currentCustomer();
  if (!customer) throw new HttpError(401, "Please enter your details first.");
  if (customer.blocked) throw new HttpError(403, "This account can't buy crypto with Banxa. Contact Banxa support for help.");
  return customer;
}

export async function rememberCustomer(id: string) {
  (await cookies()).set(COOKIE, seal(id), COOKIE_OPTIONS);
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
