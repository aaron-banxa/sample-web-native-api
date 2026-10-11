import "server-only";
import { z } from "zod";
import { banxa } from "@/lib/banxa";
import { db, now } from "@/lib/db";
import { HttpError, ValidationError } from "@/lib/http";
import type { CustomerView } from "@/lib/types";
import { findCountry } from "@/modules/catalog/lookup";
import { getCatalog } from "@/modules/catalog/server";
import { createCustomer, findCustomerByEmail, markVerified, updateUnverifiedCustomer, type Customer } from "./customers";

/**
 * Step 2 · Identity
 * Save the customer locally, make sure a Banxa identity exists for them, then have them prove they
 * own the email with Banxa's one-time code (POST /eapi/v0/verifications/otp). Only then is the
 * browser signed in.
 *
 * New and existing emails get the same response ("we sent you a code"), so the form can't be used
 * to find out who is a customer. An existing customer's stored details are never changed by
 * registering again. The customer id is the identityReference (Native API v0) and the
 * externalCustomerId (Partner API v2), which links both APIs to one person.
 */

export const identitySchema = z.object({
  email: z.email().max(254).toLowerCase(),
  givenName: z.string().trim().min(1, "Required").max(100),
  surname: z.string().trim().min(1, "Required").max(100),
  dateOfBirth: z.iso.date("Enter a valid date of birth"),
  country: z.string().length(2),
  state: z.string().min(1).max(10).optional(),
  consent: z.literal(true, "You must accept the terms to continue"),
});

export const verifyEmailSchema = z.object({
  email: z.email().max(254).toLowerCase(),
  code: z.string().regex(/^\d{4}$/, "Enter the 4-digit code"),
});

/** Ask Banxa for a new code at most this often per email. */
const RESEND_AFTER_MS = 60_000;
/** Wrong codes allowed per email in the window before verification is locked. */
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60_000;

export async function startRegistration(input: z.infer<typeof identitySchema>): Promise<{ email: string }> {
  // Country (and state, where required) must be one Banxa supports: GET /eapi/v0/countries.
  const country = findCountry(await getCatalog(), input.country);
  if (!country) throw new ValidationError([{ path: "country", message: "Banxa doesn't support customers in this country yet" }]);
  const needsState = country.states.length > 0;
  if (needsState && !country.states.some((s) => s.code === input.state)) {
    throw new ValidationError([{ path: "state", message: "Select your state" }]);
  }

  const { consent: _consent, state, ...rest } = input;
  const details = { ...rest, state: needsState ? state! : null };
  const existing = findCustomerByEmail(input.email);

  let customer: Customer;
  if (existing?.verified) {
    customer = existing; // keep what the verified owner gave us
  } else {
    customer = existing ? updateUnverifiedCustomer(existing.id, details) : createCustomer(details);
    await banxa.ensureIdentity({
      identityReference: customer.id,
      email: customer.email,
      givenName: customer.givenName,
      surname: customer.surname,
      dateOfBirth: customer.dateOfBirth,
    });
  }

  await sendCode(customer);
  return { email: customer.email };
}

/** Check the code Banxa emailed. Locks after repeated wrong codes, so 4 digits can't be guessed. */
export async function verifyEmailCode({ email, code }: z.infer<typeof verifyEmailSchema>): Promise<Customer> {
  const attempts = attemptsFor(email);
  if (attempts && attempts.failures >= MAX_FAILURES && Date.now() - Date.parse(attempts.window_start) < FAILURE_WINDOW_MS) {
    throw new HttpError(429, "Too many wrong codes. Wait 15 minutes, then ask for a new code.");
  }

  const customer = findCustomerByEmail(email);
  if (!customer || !(await banxa.verifyOtp({ identityReference: customer.id, email: customer.email, code }))) {
    recordFailure(email, attempts);
    throw new HttpError(401, "That code isn't right, or it has expired.");
  }

  db().prepare("DELETE FROM otp_attempts WHERE email = ?").run(email);
  return markVerified(customer.id);
}

interface Attempts {
  failures: number;
  window_start: string;
  last_sent: string | null;
}

const attemptsFor = (email: string) => db().prepare("SELECT failures, window_start, last_sent FROM otp_attempts WHERE email = ?").get(email) as Attempts | undefined;

async function sendCode(customer: Customer) {
  const attempts = attemptsFor(customer.email);
  if (attempts?.last_sent && Date.now() - Date.parse(attempts.last_sent) < RESEND_AFTER_MS) return; // the last code is still on its way
  await banxa.requestOtp({ identityReference: customer.id, email: customer.email });
  db()
    .prepare("INSERT INTO otp_attempts (email, window_start, last_sent) VALUES (?, ?, ?) ON CONFLICT (email) DO UPDATE SET last_sent = excluded.last_sent")
    .run(customer.email, now(), now());
}

function recordFailure(email: string, attempts: Attempts | undefined) {
  const windowOver = !attempts || Date.now() - Date.parse(attempts.window_start) >= FAILURE_WINDOW_MS;
  db()
    .prepare(
      "INSERT INTO otp_attempts (email, failures, window_start) VALUES (?, 1, ?) ON CONFLICT (email) DO UPDATE SET failures = CASE WHEN ? THEN 1 ELSE failures + 1 END, window_start = CASE WHEN ? THEN excluded.window_start ELSE window_start END",
    )
    .run(email, now(), windowOver ? 1 : 0, windowOver ? 1 : 0);
}

export const toCustomerView = (c: Customer): CustomerView => ({ id: c.id, email: c.email, givenName: c.givenName, country: c.country });
