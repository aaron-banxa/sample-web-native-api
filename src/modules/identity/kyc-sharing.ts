import "server-only";
import { createHmac } from "node:crypto";
import { banxa, isMock } from "@/lib/banxa";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import type { Customer } from "./customers";

/**
 * Reuse a verification the customer already completed in YOUR Sumsub account.
 *
 *   1. Ask Sumsub for a share token for the customer's applicant, for Banxa's client id.
 *   2. Send it to Banxa: POST /eapi/v0/identities/share/token (202, processed asynchronously).
 *   3. Wait for kyc.status = VERIFIED (GET /eapi/v0/identities/{ref} or KYC webhook), then re-check eligibility.
 *
 * Docs: https://docs.banxa.com/products/native-api/docs/how-it-works/kyc-token-sharing
 */

export const kycSharingEnabled = () => isMock || env.KYC_SHARING === "sumsub";

/** Which Sumsub applicant belongs to this customer. Change this if your Sumsub userId differs from the customer id. */
const sumsubUserIdFor = (customer: Customer) => customer.id;

async function createSumsubShareToken(customer: Customer): Promise<string> {
  if (isMock) return `mock-sumsub-${customer.id}`;

  // Sumsub request signing: HMAC-SHA256(secret, ts + METHOD + path + body), hex.
  const path = "/resources/accessTokens/-/shareToken";
  const body = JSON.stringify({ userId: sumsubUserIdFor(customer), clientId: env.SUMSUB_BANXA_CLIENT_ID });
  const ts = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", env.SUMSUB_SECRET_KEY!).update(ts + "POST" + path + body).digest("hex");

  const res = await fetch(env.SUMSUB_BASE_URL + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-App-Token": env.SUMSUB_APP_TOKEN!, "X-App-Access-Ts": ts, "X-App-Access-Sig": signature },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    console.error("[sumsub] share token failed", res.status, (await res.text()).slice(0, 200));
    throw new HttpError(502, "We couldn't reuse your existing verification. Verify with Banxa instead.");
  }
  const { token } = (await res.json()) as { token: string };
  return token;
}

/** Share the customer's existing Sumsub verification with Banxa. Verification completes asynchronously. */
export async function shareExistingKyc(customer: Customer): Promise<void> {
  if (!kycSharingEnabled()) throw new HttpError(404, "KYC sharing isn't enabled");
  const token = await createSumsubShareToken(customer); // generate close to sending: tokens expire
  await banxa.shareSumsubToken({ identityReference: customer.id, email: customer.email, sumsubToken: token });
}

/** Current Banxa verification status for the customer (document + liveness only). */
export async function kycStatus(customer: Customer) {
  return (await banxa.getIdentity(customer.id, customer.email))?.kycStatus ?? null;
}
