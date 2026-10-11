import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Banxa HMAC-SHA256 signatures.
 *
 * The same scheme is used in both directions:
 *   - requests you send to the Native API (v0)
 *   - webhooks Banxa sends to you
 *
 * Header:  Authorization: Bearer {API_KEY}:{SIGNATURE}:{NONCE}
 * Signed:  METHOD \n PATH(+query for GET, URL-decoded) \n NONCE [\n COMPACT_JSON_BODY]
 *
 * Docs: https://docs.banxa.com/products/native-api/docs/getting-started/authentication
 */

let counter = 0;

/** Unix time in microseconds (16 digits), unique per call within this process. */
export function microsecondNonce(): string {
  counter = (counter + 1) % 1000;
  return (BigInt(Date.now()) * 1000n + BigInt(counter)).toString();
}

export function sign(secret: string, method: string, path: string, nonce: string, body?: string): string {
  const payload = body ? `${method}\n${path}\n${nonce}\n${body}` : `${method}\n${path}\n${nonce}`;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Authorization header for a Native API request. `body` must be the exact compact JSON you send. */
export function authorizationHeader(key: string, secret: string, method: string, path: string, body?: string): string {
  const nonce = microsecondNonce();
  return `Bearer ${key}:${sign(secret, method, path, nonce, body)}:${nonce}`;
}

/**
 * Verify a Banxa webhook.
 * `rawBody` must be the request body exactly as received. Re-serialised JSON will not match.
 * The nonce is an opaque string: don't parse or validate it.
 */
export function verifyWebhookSignature(authHeader: string | null, rawBody: string, path: string, secret: string): boolean {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const [, signature, nonce] = authHeader.slice("Bearer ".length).split(":");
  if (!signature || !nonce) return false;

  const expected = sign(secret, "POST", path, nonce, rawBody);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
