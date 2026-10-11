import "server-only";
import { z } from "zod";
import { banxa } from "@/lib/banxa";
import { HttpError, ValidationError } from "@/lib/http";
import type { CustomerView } from "@/lib/types";
import { findCountry } from "@/modules/catalog/lookup";
import { getCatalog } from "@/modules/catalog/server";
import { createCustomer, findCustomerByEmail, type Customer } from "./customers";

/**
 * Step 2 · Identity
 * Save the customer locally, then make sure a Banxa identity exists for them.
 * The customer id is the identityReference (Native API v0) and the
 * externalCustomerId (Partner API v2), which links both APIs to one person.
 *
 * An email that is already registered can't be claimed just by typing it: the customer proves
 * they own it with a one-time code from Banxa (POST /eapi/v0/verifications/otp), and their
 * stored details are kept as they are.
 */

export const identitySchema = z.object({
  email: z.email().toLowerCase(),
  givenName: z.string().trim().min(1, "Required"),
  surname: z.string().trim().min(1, "Required"),
  dateOfBirth: z.iso.date("Enter a valid date of birth"),
  country: z.string().length(2),
  state: z.string().min(1).optional(),
  consent: z.literal(true, "You must accept the terms to continue"),
});

export const verifyEmailSchema = z.object({
  email: z.email().toLowerCase(),
  code: z.string().regex(/^\d{4}$/, "Enter the 4-digit code"),
});

/** Thrown when the email belongs to an existing customer; the client then asks for the emailed code. */
export class EmailVerificationRequired extends HttpError {
  constructor() {
    super(409, "This email is already registered. We've sent a 4-digit code to it.");
  }
}

export async function registerCustomer(input: z.infer<typeof identitySchema>, current: Customer | null): Promise<Customer> {
  const existing = findCustomerByEmail(input.email);
  if (existing) {
    if (current?.id === existing.id) return existing; // already signed in as this customer
    await banxa.requestOtp({ identityReference: existing.id, email: existing.email });
    throw new EmailVerificationRequired();
  }

  // Country (and state, where required) must be one Banxa supports: GET /eapi/v0/countries.
  const country = findCountry(await getCatalog(), input.country);
  if (!country) throw new ValidationError([{ path: "country", message: "Banxa doesn't support customers in this country yet" }]);
  const needsState = country.states.length > 0;
  if (needsState && !country.states.some((s) => s.code === input.state)) {
    throw new ValidationError([{ path: "state", message: "Select your state" }]);
  }

  const { consent: _consent, state, ...details } = input;
  const customer = createCustomer({ ...details, state: needsState ? state! : null });
  await banxa.ensureIdentity({
    identityReference: customer.id,
    email: customer.email,
    givenName: customer.givenName,
    surname: customer.surname,
    dateOfBirth: customer.dateOfBirth,
  });
  return customer;
}

/** Second half of claiming an existing email: check the code Banxa sent. */
export async function verifyExistingCustomer({ email, code }: z.infer<typeof verifyEmailSchema>): Promise<Customer> {
  const existing = findCustomerByEmail(email);
  if (!existing || !(await banxa.verifyOtp({ identityReference: existing.id, email: existing.email, code }))) {
    throw new HttpError(401, "That code isn't right, or it has expired.");
  }
  return existing;
}

export const toCustomerView = (c: Customer): CustomerView => ({ id: c.id, email: c.email, givenName: c.givenName, country: c.country });
