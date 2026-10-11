import "server-only";
import { randomBytes } from "node:crypto";
import { cryptoMeta, type Rail } from "@/config/onramp";
import { env } from "@/lib/env";
import type {
  AmountInput,
  BanxaCountry,
  BanxaCrypto,
  BanxaFiat,
  BanxaGateway,
  BanxaLimits,
  BanxaLockedQuote,
  BanxaPaymentMethod,
  BanxaPrice,
  BanxaRamp,
  EligibilityInput,
  IdentityInput,
  IdentityStatus,
  IdentityUpdate,
  KycShareInput,
  LimitsInput,
  NativeOrderInput,
  PriceInput,
  RampInput,
  RampListPage,
} from "./gateway";
import { NativeApiError } from "./native-client";
import { microsecondNonce, sign } from "./signing";

/**
 * In-memory stand-in for Banxa (BANXA_MODE=mock).
 *
 * Behaves like the real thing where it matters:
 *   - configuration endpoints return Banxa-shaped data (including a method this app can't render)
 *   - eligibility asks for due diligence at or above MOCK_EDD_THRESHOLD (AUD equivalent),
 *     a residential address at or above A$1,000, and documents at or above MOCK_VERIFICATION_THRESHOLD
 *   - locked quotes expire after 3 minutes; limits shrink as the customer buys
 *   - status changes arrive as HMAC-signed HTTP webhooks to your real webhook route
 */

const RATES_AUD: Record<string, number> = { USDT: 1.532, USDC: 1.531, BTC: 152340, ETH: 5412 };
const AUD_PER: Record<string, number> = { AUD: 1, USD: 1.532, EUR: 1.668, CAD: 1.118 };
const NETWORK_FEE_AUD: Record<string, number> = { TRON: 1.2, ETH: 4.5, SOL: 0.3, BTC: 6 };
const FEE_PERCENT: Record<string, number> = {
  "debit-credit-card": 2.99,
  "apple-pay": 2.99,
  "google-pay": 2.99,
  "payid-bank-transfer": 0.5,
  "sepa-bank-transfer": 0.5,
  "interac-bank-transfer": 1,
};
const ADDRESS_THRESHOLD_AUD = 1000;
const QUOTE_TTL_MS = 3 * 60_000;
const DAILY_LIMIT_AUD = 10_000;

const toAud = (amount: number, fiat: string) => amount * (AUD_PER[fiat] ?? 1);
const fromAud = (amount: number, fiat: string) => amount / (AUD_PER[fiat] ?? 1);

/* ---------- Configuration, shaped like GET /eapi/v0/fiats|cryptocurrencies|payment-methods|countries ---------- */

const cardLimits = { minimum: "20", maximum: "15000" }; // major units, as the sandbox returns them
const bankLimits = { minimum: "20", maximum: "50000" };
const card = (name = "Debit/Credit Card") => [
  { method: "debit-credit-card", name, ...cardLimits },
  { method: "apple-pay", name: "Apple Pay", ...cardLimits },
  { method: "google-pay", name: "Google Pay", ...cardLimits },
];

const MOCK_FIATS: BanxaFiat[] = [
  { fiat: "AUD", name: "Australian Dollar", symbol: "$", supportedPaymentMethods: [...card(), { method: "payid-bank-transfer", name: "PayID Bank Transfer", ...bankLimits }] },
  { fiat: "USD", name: "US Dollar", symbol: "$", supportedPaymentMethods: [...card(), { method: "ach-bank-transfer", name: "ACH Bank Transfer", ...bankLimits }] },
  { fiat: "EUR", name: "Euro", symbol: "€", supportedPaymentMethods: [...card(), { method: "sepa-bank-transfer", name: "SEPA Bank Transfer", ...bankLimits }] },
  { fiat: "CAD", name: "Canadian Dollar", symbol: "$", supportedPaymentMethods: [...card(), { method: "interac-bank-transfer", name: "Interac e-Transfer", ...bankLimits }] },
];

const MOCK_CRYPTOS: BanxaCrypto[] = [
  {
    crypto: "USDT",
    name: "Tether",
    blockchains: [
      { blockchain: "TRON", name: "TRON (TRC-20)", isDefault: true, address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", network: null, minimum: "1", unsupportedCountries: [] },
      { blockchain: "ETH", name: "Ethereum (ERC-20)", isDefault: false, address: "0xdac17f958d2ee523a2206206994597c13d831ec7", network: null, minimum: "10", unsupportedCountries: [] },
    ],
  },
  {
    crypto: "USDC",
    name: "USD Coin",
    blockchains: [
      { blockchain: "ETH", name: "Ethereum (ERC-20)", isDefault: true, address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", network: null, minimum: "10", unsupportedCountries: [] },
      { blockchain: "SOL", name: "Solana", isDefault: false, address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", network: null, minimum: "1", unsupportedCountries: ["GB"] },
    ],
  },
  { crypto: "BTC", name: "Bitcoin", blockchains: [{ blockchain: "BTC", name: "Bitcoin", isDefault: true, address: null, network: null, minimum: "0.0001", unsupportedCountries: [] }] },
  { crypto: "ETH", name: "Ethereum", blockchains: [{ blockchain: "ETH", name: "Ethereum", isDefault: true, address: null, network: null, minimum: "0.002", unsupportedCountries: [] }] },
];

const MOCK_PAYMENT_METHODS: BanxaPaymentMethod[] = [
  { method: "debit-credit-card", name: "Debit/Credit Card", supportedFiats: ["AUD", "USD", "EUR", "CAD"] },
  { method: "apple-pay", name: "Apple Pay", supportedFiats: ["AUD", "USD", "EUR", "CAD"] },
  { method: "google-pay", name: "Google Pay", supportedFiats: ["AUD", "USD", "EUR", "CAD"] },
  { method: "payid-bank-transfer", name: "PayID Bank Transfer", supportedFiats: ["AUD"] },
  { method: "sepa-bank-transfer", name: "SEPA Bank Transfer", supportedFiats: ["EUR"] },
  { method: "interac-bank-transfer", name: "Interac e-Transfer", supportedFiats: ["CAD"] },
  // Not renderable by this app: shows that unsupported methods are filtered out.
  { method: "ach-bank-transfer", name: "ACH Bank Transfer", supportedFiats: ["USD"] },
];

const MOCK_COUNTRIES: BanxaCountry[] = [
  { id: "AU", description: "Australia", states: [] },
  { id: "NZ", description: "New Zealand", states: [] },
  { id: "GB", description: "United Kingdom", states: [] },
  { id: "DE", description: "Germany", states: [] },
  { id: "FR", description: "France", states: [] },
  { id: "SG", description: "Singapore", states: [] },
  { id: "CA", description: "Canada", states: [{ id: "ON", description: "Ontario" }, { id: "BC", description: "British Columbia" }, { id: "QC", description: "Quebec" }] },
  { id: "US", description: "United States", states: [{ id: "CA", description: "California" }, { id: "NY", description: "New York" }, { id: "TX", description: "Texas" }, { id: "FL", description: "Florida" }] },
];

/* ---------- In-memory state ---------- */

interface MockIdentity {
  email: string;
  eddDone: boolean;
  addressDone: boolean;
  verified: boolean;
}

interface MockOrder {
  id: string;
  rail: Rail;
  status: string;
  identityReference: string;
  externalOrderId?: string;
  fiat: string;
  fiatAmount: string;
  crypto: string;
  blockchain: string;
  cryptoAmount: string;
  paymentMethodId: string;
  processingFee: string;
  networkFee: string;
  txHash?: string;
  /** Created without a native token, so the customer pays through hosted checkout. */
  hosted?: boolean;
  createdAt: Date;
}

interface MockQuote {
  input: PriceInput;
  price: ReturnType<typeof price>;
  expiresAt: number;
}

const store = ((globalThis as { __banxaMock?: { identities: Map<string, MockIdentity>; orders: Map<string, MockOrder>; quotes: Map<string, MockQuote> } }).__banxaMock ??= {
  identities: new Map(),
  orders: new Map(),
  quotes: new Map(),
});
store.quotes ??= new Map();

/** Price either side: fiat → crypto, or crypto → fiat (gross-up for fees). */
function price(input: { fiat: string; crypto: string; blockchain: string; method: string } & AmountInput) {
  const fiatPerCrypto = (RATES_AUD[input.crypto] ?? 1) / (AUD_PER[input.fiat] ?? 1);
  const pct = (FEE_PERCENT[input.method] ?? 2.99) / 100;
  const networkFee = fromAud(NETWORK_FEE_AUD[input.blockchain] ?? 2, input.fiat);
  let fiat: number, crypto: number;
  if (input.cryptoAmount !== undefined) {
    crypto = Number(input.cryptoAmount);
    fiat = (crypto * fiatPerCrypto + networkFee) / (1 - pct);
  } else {
    fiat = Number(input.fiatAmount);
    crypto = Math.max(fiat - fiat * pct - networkFee, 0) / fiatPerCrypto;
  }
  return {
    fiatAmount: fiat.toFixed(2),
    cryptoAmount: crypto.toFixed(cryptoMeta(input.crypto).decimals),
    processingFee: (fiat * pct).toFixed(2),
    networkFee: networkFee.toFixed(2),
    rate: fiatPerCrypto.toFixed(fiatPerCrypto < 10 ? 4 : 2),
  };
}

const toBanxaPrice = (input: PriceInput, p: ReturnType<typeof price>): BanxaPrice => ({
  identityReference: input.identityReference,
  source: { fiat: { id: input.fiat, method: input.method }, amount: p.fiatAmount },
  target: { crypto: { id: input.crypto, blockchain: input.blockchain }, amount: p.cryptoAmount },
  processingFee: p.processingFee,
  networkFee: p.networkFee,
  marketRate: { crypto: { [input.fiat]: p.rate } },
});

function requirementsFor(identityReference: string, fiatAmount: string, fiat: string): string[] {
  const identity = store.identities.get(identityReference);
  if (!identity) return ["NAME", "DOB"];
  const amount = toAud(Number(fiatAmount), fiat);
  const reqs: string[] = [];
  if (amount >= env.MOCK_VERIFICATION_THRESHOLD && !identity.verified) reqs.push("DOCUMENT", "SELFIE");
  if (amount >= ADDRESS_THRESHOLD_AUD && !identity.addressDone) reqs.push("ADDRESS");
  if (amount >= env.MOCK_EDD_THRESHOLD && !identity.eddDone) reqs.push("OCCUPATION", "SOURCE_FUNDS", "PURPOSE_OF_TX");
  return reqs;
}

/** Fiat amount of a request, pricing crypto amounts first. */
const fiatOf = (input: { fiat: string; crypto: string; blockchain: string; method: string } & AmountInput) =>
  input.fiatAmount ?? price(input).fiatAmount;

function spentTodayAud(identityReference: string) {
  const today = new Date().toDateString();
  return [...store.orders.values()]
    .filter((o) => o.identityReference === identityReference && o.createdAt.toDateString() === today && o.status !== "INITIALIZED" && o.status !== "pendingPayment")
    .reduce((sum, o) => sum + toAud(Number(o.fiatAmount), o.fiat), 0);
}

const newId = () => randomBytes(16).toString("hex");

function fakeTxHash(blockchain: string) {
  if (blockchain === "ETH") return "0x" + randomBytes(32).toString("hex");
  if (blockchain === "SOL") {
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    return Array.from(randomBytes(88), (b) => alphabet[b % alphabet.length]).join("");
  }
  return randomBytes(32).toString("hex");
}

function depositInstructions(method: string, orderId: string): Record<string, string> {
  const reference = `MOCK-${orderId.slice(0, 8).toUpperCase()}`;
  if (method === "sepa-bank-transfer") {
    return { depositReference: reference, recipientName: "Banxa Mock B.V.", recipientAddress: "1 Example Street, Amsterdam", IBAN: "NL00MOCK0123456789", BIC: "MOCKNL2A", bankName: "Mock Bank", bankAddress: "Amsterdam, Netherlands" };
  }
  if (method === "interac-bank-transfer") {
    return { recipientEmail: "mock-interac@example.com", securityQuestion: "What is your order reference?", securityAnswer: reference };
  }
  return { recipientEmail: "mock-payid@example.com", depositReference: reference };
}

export const mockGateway: BanxaGateway = {
  mode: "mock",

  listFiats: async () => MOCK_FIATS,
  listCryptocurrencies: async () => MOCK_CRYPTOS,
  listPaymentMethods: async () => MOCK_PAYMENT_METHODS,
  listCountries: async () => MOCK_COUNTRIES,
  listPartnerLimits: async () =>
    MOCK_FIATS.flatMap((f) => f.supportedPaymentMethods.map((m) => ({ fiat: f.fiat, method: m.method, minimum: Number(m.minimum), maximum: Number(m.maximum) }))),

  async getPrice(input: PriceInput) {
    return toBanxaPrice(input, price(input));
  },

  async getLockedQuote(input: PriceInput): Promise<BanxaLockedQuote> {
    const p = price(input);
    const quoteId = newId();
    const expiresAt = Date.now() + QUOTE_TTL_MS;
    store.quotes.set(quoteId, { input, price: p, expiresAt });
    return { ...toBanxaPrice(input, p), quoteId, expiresAt: new Date(expiresAt).toISOString() };
  },

  async getLimits({ identityReference, fiat }: LimitsInput): Promise<BanxaLimits> {
    const money = (aud: number) => ({ amount: fromAud(aud, fiat).toFixed(2), currency: fiat });
    const daily = Math.max(DAILY_LIMIT_AUD - spentTodayAud(identityReference), 0);
    return {
      identityReference,
      limits: {
        transaction: { minFiat: money(20 * (AUD_PER[fiat] ?? 1)), maxFiat: money(15_000) },
        periodical: [
          { period: "DAILY", sources: { provider: { maxFiat: money(DAILY_LIMIT_AUD), remainder: fromAud(daily, fiat).toFixed(2) }, customer: { maxFiat: money(15_000), remainder: fromAud(15_000, fiat).toFixed(2) } } },
          { period: "MONTHLY", sources: { provider: { maxFiat: money(50_000), remainder: fromAud(50_000 - spentTodayAud(identityReference), fiat).toFixed(2) } } },
        ],
      },
    };
  },

  async getIdentity(identityReference: string): Promise<IdentityStatus | null> {
    const identity = store.identities.get(identityReference);
    return identity ? { exists: true, blocked: false, kycStatus: identity.verified ? "VERIFIED" : "PENDING" } : null;
  },

  async ensureIdentity({ identityReference, email }: IdentityInput) {
    if (store.identities.has(identityReference)) return { created: false };
    store.identities.set(identityReference, { email, eddDone: false, addressDone: false, verified: false });
    return { created: true };
  },

  async shareSumsubToken({ identityReference }: KycShareInput) {
    const identity = store.identities.get(identityReference);
    if (!identity) throw new NativeApiError("Identity not found", 404, { message: "Identity not found" });
    identity.verified = true; // documents + liveness come from the shared Sumsub applicant
  },

  async requestOtp() {
    // Real Banxa emails a 4-digit code. In mock mode the code is always 1234.
  },

  async verifyOtp({ code }) {
    return code === "1234";
  },

  async checkEligibility(input: EligibilityInput) {
    const requirements = requirementsFor(input.identityReference, fiatOf({ ...input, method: input.paymentMethodId }), input.fiat);
    return { paymentReady: requirements.length === 0, requirements };
  },

  async updateIdentity(update: IdentityUpdate) {
    const identity = store.identities.get(update.identityReference);
    if (!identity) throw new NativeApiError("Identity not found", 404, { message: "Identity not found" });
    if (update.occupationIndustry && update.occupation && update.sourceOfFunds && update.purposeOfTransaction) identity.eddDone = true;
    const a = update.customerIdentity?.residentialAddress;
    if (a?.addressLine && a.suburb && a.state && a.postCode && a.country) identity.addressDone = true;
  },

  async createNativeOrder(input: NativeOrderInput) {
    const quote = price({ ...input, method: input.paymentMethodId });
    const paymentReady = requirementsFor(input.externalCustomerId, quote.fiatAmount, input.fiat).length === 0;
    const order: MockOrder = {
      id: newId(),
      rail: "native",
      status: "pendingPayment",
      identityReference: input.externalCustomerId,
      externalOrderId: input.externalOrderId,
      fiat: input.fiat,
      fiatAmount: quote.fiatAmount,
      crypto: input.crypto,
      blockchain: input.blockchain,
      cryptoAmount: quote.cryptoAmount,
      paymentMethodId: input.paymentMethodId,
      processingFee: quote.processingFee,
      networkFee: quote.networkFee,
      hosted: !paymentReady,
      createdAt: new Date(),
    };
    store.orders.set(order.id, order);
    return {
      banxaOrderId: order.id,
      paymentReady,
      nativeToken: paymentReady ? `mock_${order.id}` : undefined,
      fiatAmount: quote.fiatAmount,
      cryptoAmount: quote.cryptoAmount,
    };
  },

  async createRamp(input: RampInput): Promise<BanxaRamp> {
    let request: { fiat: string; crypto: string; blockchain: string; method: string; identityReference: string };
    let p: ReturnType<typeof price>;
    if ("quoteId" in input) {
      const quote = store.quotes.get(input.quoteId);
      if (!quote || quote.input.identityReference !== input.identityReference) throw new NativeApiError("Quote not found", 404, { message: "Quote not found" });
      if (quote.expiresAt < Date.now()) throw new NativeApiError("Quote expired", 422, { message: "Quote expired" });
      store.quotes.delete(input.quoteId);
      request = quote.input;
      p = quote.price;
    } else {
      request = input;
      p = price(input);
    }
    if (requirementsFor(request.identityReference, p.fiatAmount, request.fiat).length) {
      throw new NativeApiError("Identity is not payment ready", 422, { message: "Identity is not payment ready" });
    }
    const order: MockOrder = {
      id: newId(),
      rail: "ramp",
      status: "INITIALIZED",
      identityReference: request.identityReference,
      fiat: request.fiat,
      fiatAmount: p.fiatAmount,
      crypto: request.crypto,
      blockchain: request.blockchain,
      cryptoAmount: p.cryptoAmount,
      paymentMethodId: request.method,
      processingFee: p.processingFee,
      networkFee: p.networkFee,
      createdAt: new Date(),
    };
    store.orders.set(order.id, order);
    return { banxaOrderId: order.id, status: order.status, instructions: depositInstructions(request.method, order.id), fiatAmount: p.fiatAmount, cryptoAmount: p.cryptoAmount };
  },

  async getOrderStatus(banxaOrderId) {
    const order = store.orders.get(banxaOrderId);
    return order ? { status: order.status, transactionHash: order.txHash, cryptoAmount: order.cryptoAmount } : null;
  },

  async listRamps({ cursor, perPage }): Promise<RampListPage> {
    const ramps = [...store.orders.values()].filter((o) => o.rail === "ramp").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = cursor ? ramps.findIndex((r) => r.id === cursor) + 1 : 0;
    const page = ramps.slice(start, start + perPage);
    return {
      ramps: page.map((r) => ({ id: r.id, status: r.status, cryptoAmount: r.cryptoAmount, transactionHash: r.txHash })),
      nextCursor: start + perPage < ramps.length ? page[page.length - 1].id : null,
    };
  },
};

/* --------------------------------------------------------------------------
   Mock-only controls (used by /api/mock/*). Real Banxa does these for you.
   -------------------------------------------------------------------------- */

const PAYMENT_TIMELINE = [
  { status: "PAYMENT_RECEIVED", afterMs: 1500 },
  { status: "IN_PROGRESS", afterMs: 3500 },
  { status: "COIN_TRANSFERRED", afterMs: 6500 },
  { status: "FULFILLED", afterMs: 9500 },
];

/** Pretend the customer paid: emit the webhook sequence an order normally goes through. */
export function simulatePayment(banxaOrderId: string, appOrigin: string) {
  const order = store.orders.get(banxaOrderId);
  if (!order) throw new Error("Mock order not found");
  // Hosted checkout runs Banxa's own verification before taking payment.
  const identity = store.identities.get(order.identityReference);
  if (order.hosted && identity) Object.assign(identity, { verified: true, eddDone: true, addressDone: true });

  for (const step of PAYMENT_TIMELINE) {
    setTimeout(() => {
      order.status = step.status;
      if (step.status === "COIN_TRANSFERRED") order.txHash = fakeTxHash(order.blockchain);
      void sendWebhook(order, appOrigin);
    }, step.afterMs);
  }
}

function banxaTimestamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Sign and POST a webhook to the app, exactly as Banxa would. */
async function sendWebhook(order: MockOrder, appOrigin: string) {
  const body = JSON.stringify({
    order_id: order.id,
    transfer_id: order.id,
    status: order.status,
    status_date: banxaTimestamp(),
    created_at: banxaTimestamp(order.createdAt),
    updated_at: banxaTimestamp(),
    order_type: "ONRAMP",
    external_id: order.externalOrderId ?? null,
    crypto_coin: order.crypto,
    crypto_blockchain: order.blockchain,
    crypto_amount: order.cryptoAmount,
    fiat_currency: order.fiat,
    fiat_amount: order.fiatAmount,
    payment: order.paymentMethodId,
    processing_fee: order.processingFee,
    network_fee: order.networkFee,
    transaction_hash: order.txHash ?? "",
    internal_reason: "",
    external_reason: "",
  });
  const path = env.BANXA_WEBHOOK_PATH;
  const nonce = microsecondNonce();
  const signature = sign(env.webhookSecret, "POST", path, nonce, body);

  try {
    const res = await fetch(appOrigin + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer mock_key:${signature}:${nonce}` },
      body,
    });
    if (!res.ok) console.error(`[mock-banxa] webhook ${order.status} → ${res.status}`);
  } catch (err) {
    console.error(`[mock-banxa] could not deliver webhook ${order.status} to ${appOrigin}${path}`, err);
  }
}
