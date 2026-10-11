import "server-only";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { env } from "@/lib/env";

/**
 * SQLite via Node's built-in `node:sqlite` (no native dependencies).
 * Swap this file for Postgres or similar before running more than one server instance.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
  id            TEXT PRIMARY KEY,           -- identityReference / externalCustomerId at Banxa
  email         TEXT NOT NULL UNIQUE,
  given_name    TEXT NOT NULL,
  surname       TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  country       TEXT NOT NULL,
  state         TEXT,
  blocked       INTEGER NOT NULL DEFAULT 0,  -- set by Banxa ACCOUNT_BLOCKED webhooks
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id             TEXT PRIMARY KEY,          -- externalOrderId at Banxa
  customer_id    TEXT NOT NULL REFERENCES customers(id),
  banxa_order_id TEXT UNIQUE,
  rail           TEXT NOT NULL,             -- native (Partner API order) | ramp (Native API ramp)
  method         TEXT NOT NULL,
  status         TEXT NOT NULL,             -- AppStatus
  fiat           TEXT NOT NULL,
  fiat_amount    TEXT NOT NULL,
  crypto         TEXT NOT NULL,
  blockchain     TEXT NOT NULL,
  crypto_amount  TEXT,
  wallet_address TEXT NOT NULL,
  tx_hash        TEXT,
  payment        TEXT NOT NULL,             -- PaymentSession JSON
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS locked_quotes (
  quote_id       TEXT PRIMARY KEY,          -- Banxa quoteId (GET /eapi/v0/quote)
  customer_id    TEXT NOT NULL REFERENCES customers(id),
  draft          TEXT NOT NULL,             -- the exact order the quote was locked for
  expires_at     TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  dedupe_key     TEXT PRIMARY KEY,          -- order_id:status, or identity:<reference>:<status>
  subject        TEXT NOT NULL,             -- Banxa order_id or identity_reference
  status         TEXT NOT NULL,
  payload        TEXT NOT NULL,
  received_at    TEXT NOT NULL
);
`;

const g = globalThis as { __onrampDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (!g.__onrampDb) {
    const file = resolve(env.DATABASE_PATH);
    mkdirSync(dirname(file), { recursive: true });
    const database = new DatabaseSync(file);
    database.exec("PRAGMA journal_mode = WAL;");
    database.exec(SCHEMA);
    g.__onrampDb = database;
  }
  return g.__onrampDb;
}

export const now = () => new Date().toISOString();
