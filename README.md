# Banxa Native Onramp

A Next.js (TypeScript) onramp built on the **Banxa Native API** and the **JS Native Payments SDK**.

Identity → eligibility → enhanced due diligence / verification → order → payment (card, Apple Pay, Google Pay, PayID, SEPA, Interac) → crypto delivery, with signed webhooks driving each order to completion.

## Quick start (no credentials)

```bash
npm install
npm run dev
```

Open http://localhost:3000. It runs in **mock mode** by default: an in-process fake Banxa that follows the published API and sends HMAC-signed webhooks to the app's real webhook route.

Requires Node 22.13+ (uses the built-in `node:sqlite`).

### Trying the paths in mock mode

| To see | Do this |
| --- | --- |
| Enhanced due diligence | First order of A$200 or more, or the equivalent in USD, EUR or CAD (`MOCK_EDD_THRESHOLD`) |
| Residential address | Order of A$1,000 or more |
| ID verification (Sumsub sharing or hosted checkout) | Order of A$5,000 or more (`MOCK_VERIFICATION_THRESHOLD`) |
| Buy an exact crypto amount | Tap the "You receive" amount and type it |
| Your limits | Shown under the amounts once you're registered; they shrink as you buy |
| Locked rate | Pay by PayID, SEPA or Interac: the review step locks the rate for 3 minutes |
| Bank transfers | AUD → PayID, EUR → SEPA, CAD → Interac. ACH is offered by the mock but hidden (not supported by this app) |
| Card decline | Card number `4000 0000 0000 0002` |
| Existing email | Register again with the same email from another browser: you're asked for a code (`1234` in mock mode) |
| Order history | "Your orders" under the Continue button |
| Country restrictions | Register with a UK address, then pick USDC on Solana |

## Running against the Banxa sandbox

```bash
cp .env.example .env.local
```

Set `BANXA_MODE=sandbox`, `BANXA_PARTNER`, `BANXA_API_KEY` (Partner API v2), `BANXA_NATIVE_KEY` and `BANXA_NATIVE_SECRET` (Native API v0), and `SESSION_SECRET`.

- **Webhooks**: expose the app (for example `ngrok http 3000`) and set `https://<host>/api/webhooks/banxa` in the Partner Dashboard. Without webhooks, an open order page still updates by polling Banxa every 15 seconds.
- **Reconciliation**: set `SYNC_SECRET` and call `POST /api/sync` with `Authorization: Bearer <secret>` on a schedule. It pages through `GET /eapi/v0/ramps` and checks open card/wallet orders.
- **APP_URL**: the public URL. Used as the order `redirectUrl`.
- **Apple Pay**: register your domain with Banxa, host the association file at `/.well-known/apple-developer-merchantid-domain-association`, and set `NEXT_PUBLIC_MERCHANT_DOMAIN`.
- **Google Pay**: Chrome and Android only. Production needs your own Google Pay approval.
- **Sumsub KYC sharing** (optional): `KYC_SHARING=sumsub`, `SUMSUB_APP_TOKEN`, `SUMSUB_SECRET_KEY`. By default the customer id is used as the Sumsub `userId`; change `sumsubUserIdFor` in `src/modules/identity/kyc-sharing.ts` if yours differs.

### Troubleshooting: "self-signed certificate in certificate chain"

If Banxa calls fail with this error, a network security tool (Cloudflare WARP/Zero Trust, Zscaler, Netskope…) is inspecting HTTPS with its own certificate. Your OS trusts it; Node doesn't. Export the certificate and point Node at it (don't disable TLS checks):

```bash
security find-certificate -a -c "Gateway CA - Cloudflare" -p /Library/Keychains/System.keychain > ~/.cloudflare-gateway-ca.pem
NODE_EXTRA_CA_CERTS=~/.cloudflare-gateway-ca.pem npm run dev
```

Replace the certificate name with your tool's CA. Add the `export NODE_EXTRA_CA_CERTS=…` line to your shell profile to make it permanent.

### Sandbox behaviour that differs from the docs

Found while testing against `api.banxa-sandbox.com`. The app handles each one:

| What | Docs / spec | Sandbox | Handled in |
| --- | --- | --- | --- |
| Request signing for GET with a query | path + query | the **URL-decoded** path + query (`@`, not `%40`) | `lib/banxa/native-client.ts` |
| `/fiats` min/max | minor units | major units (`"30"` = A$30) | `modules/catalog/server.ts` |
| Card/wallet limits | – | Partner API (v2) limits can be narrower than `/fiats` (card A$5–100 vs A$30–15,000); the overlap is used | `modules/catalog/server.ts` |
| `GET /quote` `expiresAt` | date-time | `"2026-10-10 21:49:04"` (UTC, no zone) | `modules/quote/server.ts` |
| `PATCH /identities` | – | 400 `code 4005 "KYC sharing not enabled"` unless enabled for the partner; the app then sends customers to hosted checkout | `modules/eligibility`, `modules/due-diligence` |
| `GET /ramps` | dates optional with cursor | needs `cursor` (empty for page 1) or `dateFrom`/`dateTo`; pagination flag is `hasMorePages`; amounts are numbers | `lib/banxa/real-gateway.ts` |
| `GET /identities/{ref}` for unknown ref | 404 | 200 with `account.exists: false` | `lib/banxa/real-gateway.ts` |
| Wrong OTP code | – | 400 `code 180` | `lib/banxa/real-gateway.ts` |
| `/cryptocurrencies` | – | the same network can appear twice for an asset | `modules/catalog/server.ts` |

## How it fits together

All Banxa calls happen on the server. The browser only ever receives a short-lived `nativeToken` for the payment sheet, or deposit instructions for a bank transfer.

| Step | Module | Banxa |
| --- | --- | --- |
| Configuration | `src/modules/catalog` | v0 `GET /fiats/onramp`, `/payment-methods/onramp`, `/cryptocurrencies/onramp`, `/countries` |
| 1. Quote | `src/modules/quote`, `src/modules/limits` | v0 `GET /price`, `POST /identities/transactions/limits` |
| 2. Identity | `src/modules/identity` | v0 `GET /identities/{ref}`, `POST /identities/basic`, `POST /verifications/otp` (+ `/verify`) |
| 3. Eligibility | `src/modules/eligibility` | v0 `POST /identities/transactions/eligibility` |
| 4. Due diligence / verification | `src/modules/due-diligence`, `src/modules/identity/kyc-sharing.ts` | v0 `PATCH /identities`, `POST /identities/share/token` |
| 5. Order | `src/modules/order` | Card/wallets: v2 `checkOrderEligibility` + `createOrder` (SDK). Bank transfers: v0 `GET /quote` (locked) + `POST /ramps` |
| 6. Payment | `src/modules/payment` | `<banxa-primer-checkout>`, Banxa hosted checkout (full-page redirect), or deposit instructions |
| 7. Delivery | `src/modules/fulfilment` | Webhooks to `/api/webhooks/banxa`, pushed to the browser over SSE. Fallback: `GET /ramps/{id}`, v2 `getOrder` |
| History & sync | `src/modules/order/orders-step.tsx`, `sync.ts` | v0 `GET /ramps` |

Each module has a `server.ts` (business logic, server-only) and its UI component. Route handlers in `src/app/api` stay thin.

```
src/
  app/api/            route handlers
  components/onramp/  widget shell, step routing, catalog context
  config/onramp.ts    display metadata and the payment methods this app can render
  lib/banxa/          gateway interface, real (v0 HMAC + v2 SDK) and mock implementations, signing
  lib/db.ts           SQLite schema (customers, orders, locked_quotes, webhook_events)
  lib/session.ts      signed session cookie
  modules/            one folder per step
```

### Decisions worth knowing

- **Banxa decides what's on offer.** Currencies, payment methods and limits, cryptos and networks, minimums and countries come from the configuration endpoints. They're cached for 10 minutes (the last good copy is served if a refresh fails) and re-validated on the server for every request. `src/config/onramp.ts` only holds display details, wallet address formats and the methods this app can render (`SUPPORTED_METHODS`). Networks that need a memo/tag (XRP, XLM…) are hidden because the app doesn't collect one.
- **One customer id everywhere.** A server-generated `cus-…` id (letters, digits and hyphens, as Banxa requires) is the `identityReference` (v0) and the `externalCustomerId` (v2). Identities are looked up first and never recreated. Name and date of birth are sent at creation, and re-sent automatically if Banxa asks for NAME/DOB.
- **No account takeover by email.** Session cookies are HMAC-signed. Registering with an email that already exists doesn't overwrite anything: the customer must enter the code Banxa emails them before this browser is linked to that account.
- **Gate on `paymentReady` only.** ADDRESS, OCCUPATION, SOURCE_FUNDS, PURPOSE_OF_TX and TIN are collected in-app, with values from the spec's enums (`src/modules/due-diligence/options.ts`). DOCUMENT, SELFIE and POA go to Sumsub sharing (when enabled) or Banxa hosted checkout. Eligibility 422s (limits, age, location) get a clear message.
- **Locked rates are bound to the order.** A `quoteId` from `GET /quote` is stored against the customer and the exact draft, and refused if either changes or it has expired.
- **Orders are idempotent.** The review screen sends a key that becomes the order id (Banxa's `externalOrderId`), so retries and double clicks return the same order.
- **Webhooks finish orders, not the payment sheet.** `banxa:payment-success` only means authorised. The webhook route verifies the HMAC against the raw body, handles identity (`ACCOUNT_BLOCKED`) and ramp messages, and skips already-processed events. An unknown order gets a 404, so Banxa retries once it's saved. Every Banxa status vocabulary (webhooks, getRamp, listRamps, v2) maps onto one model in `src/modules/fulfilment/status.ts`. Unknown statuses and late failures can't overwrite progress.
- **Hosted checkout is a full-page redirect.** ID and selfie checks need the camera, which browsers block in cross-origin iframes.

## Before going live

- Replace the cookie-based customer (`src/lib/session.ts`) with your own auth, and use your user id as the identity reference.
- Swap SQLite for your database. If you run more than one instance, replace the in-process SSE pub/sub (`src/modules/fulfilment/events.ts`) with Redis or similar.
- Add rate limiting in front of `/api/quote` (unauthenticated, calls Banxa `/price`).
- Confirm these with Banxa for your account. The public spec doesn't settle them:
  - payment method ids and `paymentReady` behaviour for card and wallet orders on the Partner API (v2)
  - which secret signs webhooks for v2 orders (`BANXA_WEBHOOK_SECRET`)
  - whether `/price` accepts an `identityReference` that hasn't been registered as an identity yet

The Native API calls follow the published OpenAPI spec: https://docs.banxa.com/products/native-api/openapi
