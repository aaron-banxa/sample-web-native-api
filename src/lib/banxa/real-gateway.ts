import "server-only";
import { BanxaApiClient } from "@banxa-official/javascript-native-payments-sdk";
import type { Rail } from "@/config/onramp";
import { HttpError } from "@/lib/http";
import { IdentityUpdatesUnavailable } from "./gateway";
import { createNativeClient, NativeApiError } from "./native-client";
import type {
  AmountInput,
  BanxaCountry,
  BanxaCrypto,
  BanxaFiat,
  BanxaGateway,
  BanxaLimits,
  BanxaLockedQuote,
  BanxaOrderStatus,
  BanxaPaymentMethod,
  BanxaPrice,
  BanxaRamp,
  Eligibility,
  EligibilityInput,
  IdentityInput,
  IdentityStatus,
  IdentityUpdate,
  KycShareInput,
  LimitsInput,
  NativeOrder,
  NativeOrderInput,
  PartnerLimit,
  PriceInput,
  RampInput,
  RampListPage,
} from "./gateway";

/**
 * Banxa gateway backed by the real APIs.
 *
 *   Native API v0 (HMAC):                              configuration, pricing, limits, identities, KYC sharing,
 *                                                      eligibility, due diligence, bank-transfer ramps
 *   Partner API v2 (SDK `BanxaApiClient`, x-api-key): card/wallet orders and their status
 *
 * Request and response shapes follow https://docs.banxa.com/products/native-api/openapi
 */

interface Config {
  mode: "sandbox" | "production";
  partner: string;
  apiKey: string;
  nativeKey: string;
  nativeSecret: string;
}

/** Amounts arrive as strings or numbers depending on the endpoint. */
type Amount = string | number;

interface RampResponse {
  id: string;
  status: string;
  source?: { amount?: Amount };
  target?: { amount?: Amount };
  sourceDepositInstructions?: Record<string, unknown>;
  receipt?: { sourceAmount?: Amount; targetAmount?: Amount; targetTransactionHash?: string | null };
}

const str = (v?: Amount | null) => (v === undefined || v === null ? undefined : String(v));

interface RampListResponse {
  data: RampResponse[];
  /** Sandbox returns `hasMorePages` (the spec says `hasMore`). */
  pagination: { nextCursor?: string | null; hasMore?: boolean; hasMorePages?: boolean };
}

interface EligibilityResponse {
  paymentReady: boolean;
  kycRequirements: string[];
}

interface IdentityResponse {
  identityReference: string;
  account: { blocked: boolean; exists: boolean; createdAt: string | null };
  kyc: { status: "PENDING" | "UNDER_REVIEW" | "ACTION_REQUIRED" | "VERIFIED" | "REJECTED" };
}

/** Exactly one of fiatAmount / cryptoAmount, as Banxa requires. */
const amountOf = (a: AmountInput): Record<string, string> =>
  a.cryptoAmount !== undefined ? { cryptoAmount: a.cryptoAmount } : { fiatAmount: a.fiatAmount! };

/** Keep only string values: deposit instructions are shown as label/value rows. */
const stringFields = (o: Record<string, unknown> = {}) =>
  Object.fromEntries(Object.entries(o).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""));

export function createRealGateway(config: Config): BanxaGateway {
  const partner = new BanxaApiClient({ apiKey: config.apiKey, partner: config.partner, environment: config.mode });
  const native = createNativeClient({ key: config.nativeKey, secret: config.nativeSecret, environment: config.mode });

  const pricingQuery = (input: PriceInput) =>
    new URLSearchParams({
      identityReference: input.identityReference,
      fiat: input.fiat,
      crypto: input.crypto,
      blockchain: input.blockchain,
      method: input.method,
      transactionType: "ONRAMP",
      ...amountOf(input),
    });

  return {
    mode: config.mode,

    listFiats: () => native.get<BanxaFiat[]>("/fiats/onramp"),
    listCryptocurrencies: () => native.get<BanxaCrypto[]>("/cryptocurrencies/onramp"),
    listPaymentMethods: () => native.get<BanxaPaymentMethod[]>("/payment-methods/onramp"),
    listCountries: () => native.get<BanxaCountry[]>("/countries"),

    async listPartnerLimits(): Promise<PartnerLimit[]> {
      const fiats = await partner.getFiatCurrencies("buy");
      return fiats.flatMap((f) =>
        (f.supportedPaymentMethods ?? []).map((m) => ({ fiat: f.id, method: m.id, minimum: Number(m.minimum ?? 0), maximum: Number(m.maximum ?? Infinity) })),
      );
    },

    async getPrice(input: PriceInput): Promise<BanxaPrice> {
      try {
        return await native.get<BanxaPrice>(`/price?${pricingQuery(input)}`);
      } catch (err) {
        // If your account only prices known identities, visitors who haven't registered yet
        // fall back to the Partner API quote, which doesn't need one.
        if (!(err instanceof NativeApiError) || err.statusCode !== 404) throw err;
        const q = await partner.getQuote(
          { fiat: input.fiat, crypto: input.crypto, blockchain: input.blockchain, paymentMethodId: input.method, ...amountOf(input) },
          "buy",
        );
        return {
          source: { fiat: { id: input.fiat, method: input.method }, amount: q.fiatAmount },
          target: { crypto: { id: input.crypto, blockchain: input.blockchain }, amount: q.cryptoAmount },
          processingFee: q.processingFee,
          networkFee: q.networkFee,
        };
      }
    },

    getLockedQuote: (input: PriceInput) => native.get<BanxaLockedQuote>(`/quote?${pricingQuery(input)}`),

    getLimits: (input: LimitsInput) => native.post<BanxaLimits>("/identities/transactions/limits", { ...input, transactionType: "ONRAMP" }),

    async getIdentity(identityReference: string, email: string): Promise<IdentityStatus | null> {
      try {
        const res = await native.get<IdentityResponse>(`/identities/${encodeURIComponent(identityReference)}?email=${encodeURIComponent(email)}`);
        return { exists: res.account.exists, blocked: res.account.blocked, kycStatus: res.kyc?.status ?? null };
      } catch (err) {
        if (err instanceof NativeApiError && err.statusCode === 404) return null;
        throw err;
      }
    },

    async ensureIdentity({ identityReference, email, givenName, surname, dateOfBirth }: IdentityInput) {
      // Identities are permanent: look up first, never recreate one.
      const identity = await this.getIdentity(identityReference, email);
      if (identity?.blocked) throw new HttpError(403, "This account can't buy crypto with Banxa. Contact Banxa support for help.");
      if (identity?.exists) return { created: false };

      // Sending the name and date of birth up front avoids NAME / DOB requirements later.
      await native.post("/identities/basic", { identityReference, email, givenName, surname, dateOfBirth });
      return { created: true };
    },

    async shareSumsubToken({ identityReference, email, sumsubToken }: KycShareInput) {
      await native.post("/identities/share/token", { identityReference, email, provider: { vendor: "sumsub", token: sumsubToken } });
    },

    async requestOtp({ identityReference, email }) {
      await native.post("/verifications/otp", { identityReference, email });
    },

    async verifyOtp({ identityReference, email, code }) {
      try {
        await native.post("/verifications/otp/verify", { identityReference, email, code });
        return true;
      } catch (err) {
        // Wrong or expired code: sandbox returns 400 { code: 180, message: "Code does not match…" }.
        if (err instanceof NativeApiError && [400, 401, 403, 422].includes(err.statusCode)) return false;
        throw err;
      }
    },

    async checkEligibility(input: EligibilityInput): Promise<Eligibility> {
      // 422 means a restriction (limit breach, age, locality, unsupported asset); see http.ts.
      const res = await native.post<EligibilityResponse>("/identities/transactions/eligibility", {
        identityReference: input.identityReference,
        transactionType: "ONRAMP",
        method: input.paymentMethodId,
        fiat: input.fiat,
        crypto: input.crypto,
        blockchain: input.blockchain,
        ...amountOf(input),
      });
      return { paymentReady: res.paymentReady === true, requirements: res.kycRequirements ?? [] };
    },

    async updateIdentity(update: IdentityUpdate) {
      // identityReference and email are both required on PATCH.
      try {
        await native.patch("/identities", update);
      } catch (err) {
        // Seen in sandbox: 400 { code: 4005, message: "KYC sharing not enabled" } when the partner can't update identities.
        if (err instanceof NativeApiError && err.statusCode === 400 && (err.body as { code?: number })?.code === 4005) throw new IdentityUpdatesUnavailable();
        throw err;
      }
    },

    async createNativeOrder(input: NativeOrderInput): Promise<NativeOrder> {
      const request = {
        externalCustomerId: input.externalCustomerId, // same value as identityReference
        externalOrderId: input.externalOrderId,
        email: input.email,
        fiat: input.fiat,
        crypto: input.crypto,
        blockchain: input.blockchain,
        walletAddress: input.walletAddress,
        paymentMethodId: input.paymentMethodId,
        redirectUrl: input.redirectUrl,
        ...amountOf(input),
      };
      // Gate the native sheet on paymentReady only.
      const eligibility = await partner.checkOrderEligibility(request, "buy");
      const order = await partner.createOrder(request);
      return {
        banxaOrderId: order.id,
        paymentReady: eligibility.paymentReady === true && !!order.nativeToken,
        nativeToken: order.nativeToken,
        checkoutUrl: order.checkoutUrl,
        fiatAmount: order.fiatAmount,
        cryptoAmount: order.cryptoAmount,
      };
    },

    async createRamp(input: RampInput): Promise<BanxaRamp> {
      const body =
        "quoteId" in input
          ? // Locked quote: source, target and amount come from the quote.
            { quoteId: input.quoteId, identityReference: input.identityReference, walletAddress: input.walletAddress }
          : {
              identityReference: input.identityReference,
              source: { fiat: { id: input.fiat, method: input.method } },
              target: { crypto: { id: input.crypto, blockchain: input.blockchain, walletAddress: input.walletAddress } },
              ...amountOf(input),
            };
      const ramp = await native.post<RampResponse>("/ramps", body);
      const instructions = stringFields(ramp.sourceDepositInstructions);
      if (Object.keys(instructions).length === 0) throw new Error(`Banxa ramp ${ramp.id} returned no deposit instructions`);
      return {
        banxaOrderId: ramp.id,
        status: ramp.status,
        instructions,
        fiatAmount: str(ramp.receipt?.sourceAmount ?? ramp.source?.amount),
        cryptoAmount: str(ramp.receipt?.targetAmount ?? ramp.target?.amount),
      };
    },

    async getOrderStatus(banxaOrderId: string, rail: Rail): Promise<BanxaOrderStatus | null> {
      if (rail === "ramp") {
        const ramp = await native.get<RampResponse>(`/ramps/${encodeURIComponent(banxaOrderId)}`);
        return { status: ramp.status, transactionHash: ramp.receipt?.targetTransactionHash ?? undefined, cryptoAmount: str(ramp.receipt?.targetAmount) };
      }
      const order = await partner.getOrder(banxaOrderId);
      return order.status ? { status: order.status, cryptoAmount: order.cryptoAmount ?? order.target_amount } : null;
    },

    async listRamps({ cursor, perPage }): Promise<RampListPage> {
      // Cursor pagination, newest first. Sending `cursor` (empty for the first page) avoids the
      // dateFrom/dateTo parameters that offset pagination requires.
      const query = new URLSearchParams({ perPage: String(perPage), cursor: cursor ?? "" });
      const res = await native.get<RampListResponse>(`/ramps?${query}`, { unwrap: false });
      const more = res.pagination?.hasMorePages ?? res.pagination?.hasMore ?? false;
      return {
        ramps: res.data.map((r) => ({
          id: r.id,
          status: r.status,
          cryptoAmount: str(r.receipt?.targetAmount ?? r.target?.amount),
          transactionHash: r.receipt?.targetTransactionHash ?? undefined,
        })),
        nextCursor: more ? (res.pagination.nextCursor ?? null) : null,
      };
    },
  };
}
