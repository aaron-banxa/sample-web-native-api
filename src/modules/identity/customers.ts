import "server-only";
import { randomBytes } from "node:crypto";
import { db, now } from "@/lib/db";

export interface Customer {
  id: string;
  email: string;
  givenName: string;
  surname: string;
  dateOfBirth: string;
  country: string;
  state: string | null;
  blocked: boolean;
  /** Proved they own the email with Banxa's one-time code. Sessions are only issued after this. */
  verified: boolean;
  /** Part of every session cookie; bumping it signs out every browser. */
  sessionVersion: number;
}

interface Row {
  id: string;
  email: string;
  given_name: string;
  surname: string;
  date_of_birth: string;
  country: string;
  state: string | null;
  blocked: number;
  verified_at: string | null;
  session_version: number;
}

const toCustomer = (r: Row): Customer => ({
  id: r.id,
  email: r.email,
  givenName: r.given_name,
  surname: r.surname,
  dateOfBirth: r.date_of_birth,
  country: r.country,
  state: r.state,
  blocked: r.blocked === 1,
  verified: r.verified_at !== null,
  sessionVersion: r.session_version,
});

type Details = Pick<Customer, "email" | "givenName" | "surname" | "dateOfBirth" | "country" | "state">;

/** Banxa identityReference allows only letters, digits and hyphens. */
const ID_PATTERN = /^cus-[a-f0-9]{16}$/;
export const newCustomerId = () => `cus-${randomBytes(8).toString("hex")}`;
export const isCustomerId = (id: string) => ID_PATTERN.test(id);

export function findCustomerById(id: string): Customer | null {
  const row = db().prepare("SELECT * FROM customers WHERE id = ?").get(id) as Row | undefined;
  return row ? toCustomer(row) : null;
}

export function findCustomerByEmail(email: string): Customer | null {
  const row = db().prepare("SELECT * FROM customers WHERE email = ?").get(email) as Row | undefined;
  return row ? toCustomer(row) : null;
}

/** Create a customer who hasn't verified their email yet. The id is always generated here, never taken from the client. */
export function createCustomer(input: Details): Customer {
  const id = newCustomerId();
  db()
    .prepare("INSERT INTO customers (id, email, given_name, surname, date_of_birth, country, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, input.email, input.givenName, input.surname, input.dateOfBirth, input.country, input.state, now());
  return { id, ...input, blocked: false, verified: false, sessionVersion: 0 };
}

/** Nobody has proved they own this email yet, so the latest registration's details replace the earlier ones. */
export function updateUnverifiedCustomer(id: string, input: Details): Customer {
  db()
    .prepare("UPDATE customers SET given_name = ?, surname = ?, date_of_birth = ?, country = ?, state = ? WHERE id = ? AND verified_at IS NULL")
    .run(input.givenName, input.surname, input.dateOfBirth, input.country, input.state, id);
  return findCustomerById(id)!;
}

/** The customer entered the right code: mark the email verified and sign out every other browser. */
export function markVerified(id: string): Customer {
  db().prepare("UPDATE customers SET verified_at = COALESCE(verified_at, ?), session_version = session_version + 1 WHERE id = ?").run(now(), id);
  return findCustomerById(id)!;
}

/** Banxa identity webhook ACCOUNT_BLOCKED. */
export function markCustomerBlocked(id: string) {
  db().prepare("UPDATE customers SET blocked = 1 WHERE id = ?").run(id);
}
