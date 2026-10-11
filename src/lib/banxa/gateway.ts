/**
 * Everything the app needs from Banxa, behind one interface.
 *
 * `real-gateway.ts` implements it against the Banxa APIs.
 * `mock-gateway.ts` implements it in memory so the app runs without credentials.
 */

import type { BanxaMode } from "@/lib/env";
import type { Rail } from "@/config/onramp";

/** PATCH /identities isn't enabled for this partner (Banxa error 4005). Banxa hosted checkout collects the data instead. */
export class IdentityUpdatesUnavailable extends Error {
  constructor() {
    super("Identity updates aren't enabled for this Banxa account");
  }
}

/** Banxa takes exactly one of fiatAmount or cryptoAmount. */
export type AmountInput = { fiatAmount: string; cryptoAmount?: never } | { cryptoAmount: string; fiatAmount?: never };

/* ---------- Native API configuration (GET /eapi/v0/fiats|cryptocurrencies|payment-methods|countries) ---------- */

export interface BanxaFiat {
  fiat: string;
  name: string;
  symbol: string;
  /** minimum / maximum per order, in major units (e.g. "30" = A$30). */
  supportedPaymentMethods: { method: string; name: string; minimum: string; maximum: string }[];
}

export interface BanxaCrypto {
  crypto: string;
  name: string;
  blockchains: {
    blockchain: string;
    name: string;
    isDefault: boolean;
    /** Token contract address (null for native coins). Not a wallet pattern. */
    address: string | null;
    network: string | null;
    minimum: string;
    unsupportedCountries: string[];
  }[];
}

/** Per-order limits on the Partner API (v2), which card and wallet orders must also satisfy. */
export interface PartnerLimit {
  fiat: string;
  method: string;
  minimum: number;
  maximum: number;
}

export interface BanxaPaymentMethod {
  method: string;
  name: string;
  supportedFiats: string[];
}

export interface BanxaCountry {
  id: string;
  description: string;
  states: { id: string; description: string }[];
}

/* ---------- Pricing (GET /eapi/v0/price, GET /eapi/v0/quote) ---------- */

export type PriceInput = {
  identityReference: string;
  fiat: string;
  crypto: string;
  blockchain: string;
  method: string;
} & AmountInput;

export interface BanxaPrice {
  identityReference?: string;
  source: { fiat: { id: string; method: string }; amount: string };
  target: { crypto: { id: string; blockchain: string }; amount: string };
  processingFee: string;
  networkFee: string;
  marketRate?: { crypto?: Record<string, string>; forex?: Record<string, string> };
}

/** Locked price, valid until `expiresAt` (about 3 minutes). Bank transfers only. */
export interface BanxaLockedQuote extends BanxaPrice {
  quoteId: string;
  expiresAt: string;
}

/* ---------- Limits (POST /eapi/v0/identities/transactions/limits) ---------- */

export interface LimitsInput {
  identityReference: string;
  method: string;
  fiat: string;
  crypto: string;
  blockchain: string;
}

interface LimitAmounts {
  maxFiat?: { amount: string; currency: string };
  remainder?: string;
}

export interface BanxaLimits {
  identityReference: string;
  limits: {
    transaction?: { maxFiat?: { amount: string; currency: string }; minFiat?: { amount: string; currency: string } };
    periodical?: { period: string; sources?: { provider?: LimitAmounts; customer?: LimitAmounts } }[];
  };
}

/* ---------- Identities ---------- */

export interface IdentityInput {
  /** Your stable customer id (letters, digits, hyphens). Reused as `externalCustomerId` on v2 orders. */
  identityReference: string;
  email: string;
  givenName: string;
  surname: string;
  dateOfBirth: string;
}

export interface ResidentialAddress {
  addressLine: string;
  suburb: string;
  state: string;
  postCode: string;
  country: string;
}

export interface IdentityUpdate {
  identityReference: string;
  email: string;
  occupationIndustry?: string;
  occupation?: string;
  sourceOfFunds?: string;
  purposeOfTransaction?: string;
  customerIdentity?: {
    givenName?: string;
    surname?: string;
    dob?: string;
    taxIdType?: string;
    taxId?: string;
    residentialAddress?: ResidentialAddress;
  };
}

export type KycStatus = "PENDING" | "UNDER_REVIEW" | "ACTION_REQUIRED" | "VERIFIED" | "REJECTED";

export interface IdentityStatus {
  exists: boolean;
  blocked: boolean;
  /** Document + liveness verification only. Use eligibility to decide if the customer can transact. */
  kycStatus: KycStatus | null;
}

export interface KycShareInput {
  identityReference: string;
  email: string;
  /** Sumsub share token for the customer's existing applicant. */
  sumsubToken: string;
}

/* ---------- Eligibility ---------- */

export type EligibilityInput = {
  identityReference: string;
  fiat: string;
  crypto: string;
  blockchain: string;
  paymentMethodId: string;
} & AmountInput;

export interface Eligibility {
  paymentReady: boolean;
  requirements: string[];
}

/* ---------- Orders ---------- */

export type NativeOrderInput = {
  externalCustomerId: string;
  externalOrderId: string;
  email: string;
  fiat: string;
  crypto: string;
  blockchain: string;
  walletAddress: string;
  paymentMethodId: string;
  redirectUrl: string;
} & AmountInput;

export interface NativeOrder {
  banxaOrderId: string;
  /** False when the order must go through Banxa hosted checkout instead of the native sheet. */
  paymentReady: boolean;
  nativeToken?: string;
  checkoutUrl?: string;
  fiatAmount?: string;
  cryptoAmount?: string;
}

/** A bank-transfer ramp (POST /eapi/v0/ramps), either priced now or from a locked quote. */
export type RampInput =
  | ({ identityReference: string; fiat: string; method: string; crypto: string; blockchain: string; walletAddress: string } & AmountInput)
  | { quoteId: string; identityReference: string; walletAddress: string };

export interface BanxaRamp {
  banxaOrderId: string;
  status: string;
  /** Deposit details to show the customer. Fields depend on the method (PayID, SEPA, Interac…). */
  instructions: Record<string, string>;
  fiatAmount?: string;
  cryptoAmount?: string;
}

export interface BanxaOrderStatus {
  status: string;
  transactionHash?: string;
  cryptoAmount?: string;
}

export interface RampListPage {
  ramps: { id: string; status: string; cryptoAmount?: string; transactionHash?: string }[];
  nextCursor: string | null;
}

export interface BanxaGateway {
  readonly mode: BanxaMode;
  listFiats(): Promise<BanxaFiat[]>;
  listCryptocurrencies(): Promise<BanxaCrypto[]>;
  listPaymentMethods(): Promise<BanxaPaymentMethod[]>;
  listCountries(): Promise<BanxaCountry[]>;
  /** v2 GET /fiats/buy limits (SDK getFiatCurrencies). They can be narrower than the Native API's. */
  listPartnerLimits(): Promise<PartnerLimit[]>;
  /** Indicative price. Not locked. */
  getPrice(input: PriceInput): Promise<BanxaPrice>;
  getLockedQuote(input: PriceInput): Promise<BanxaLockedQuote>;
  getLimits(input: LimitsInput): Promise<BanxaLimits>;
  /** GET /eapi/v0/identities/{identityReference}. Null if Banxa doesn't know it. */
  getIdentity(identityReference: string, email: string): Promise<IdentityStatus | null>;
  /** Look up the identity; create a basic identity only if it doesn't exist. */
  ensureIdentity(input: IdentityInput): Promise<{ created: boolean }>;
  shareSumsubToken(input: KycShareInput): Promise<void>;
  /** Email a one-time code to the customer (POST /eapi/v0/verifications/otp). */
  requestOtp(input: { identityReference: string; email: string }): Promise<void>;
  /** True if the code is correct (POST /eapi/v0/verifications/otp/verify). */
  verifyOtp(input: { identityReference: string; email: string; code: string }): Promise<boolean>;
  checkEligibility(input: EligibilityInput): Promise<Eligibility>;
  updateIdentity(update: IdentityUpdate): Promise<void>;
  createNativeOrder(input: NativeOrderInput): Promise<NativeOrder>;
  createRamp(input: RampInput): Promise<BanxaRamp>;
  getOrderStatus(banxaOrderId: string, rail: Rail): Promise<BanxaOrderStatus | null>;
  listRamps(page: { cursor?: string; perPage: number }): Promise<RampListPage>;
}
