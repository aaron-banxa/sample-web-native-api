/** Types shared between the browser and the server. No secrets in here. */

import type { MethodId, Rail } from "@/config/onramp";
import type { AppStatus } from "@/modules/fulfilment/status";

export interface OrderDraft {
  fiat: string;
  /** Which amount the customer typed. The other one is estimated from the quote. */
  amountType: "fiat" | "crypto";
  fiatAmount: string;
  cryptoAmount: string;
  crypto: string;
  blockchain: string;
  walletAddress: string;
  method: MethodId;
}

export interface QuoteView {
  fiatAmount: string;
  cryptoAmount: string;
  processingFee: string;
  networkFee: string;
  /** Price of one unit of crypto in fiat, when Banxa provides it. */
  rate: string | null;
}

/** A price locked for a few minutes (bank transfers only). Pass `quoteId` when creating the order. */
export interface LockedQuoteView extends QuoteView {
  quoteId: string;
  expiresAt: string;
}

/** The customer's limits for a currency and method, from Banxa. */
export interface LimitsView {
  currency: string;
  /** Per order. */
  minimum: number | null;
  maximum: number | null;
  /** Remaining allowance per period (the lower of provider and customer limits). */
  remaining: { period: string; amount: number }[];
}

/** One row in the customer's order history. */
export interface OrderSummary {
  id: string;
  status: AppStatus;
  method: MethodId;
  fiat: string;
  fiatAmount: string;
  crypto: string;
  cryptoAmount: string | null;
  createdAt: string;
}

/* ---------- Catalog: what Banxa supports, from the Native API configuration endpoints ---------- */

export interface CatalogMethod {
  id: MethodId;
  name: string;
  /** Order limits in major units of the fiat (e.g. dollars). */
  minimum: number;
  maximum: number;
}

export interface CatalogFiat {
  code: string;
  name: string;
  symbol: string;
  methods: CatalogMethod[];
}

export interface CatalogNetwork {
  id: string;
  name: string;
  isDefault: boolean;
  minimum: string | null;
}

export interface CatalogCrypto {
  code: string;
  name: string;
  networks: CatalogNetwork[];
}

export interface CatalogCountry {
  code: string;
  name: string;
  states: { code: string; name: string }[];
}

export interface Catalog {
  fiats: CatalogFiat[];
  cryptos: CatalogCrypto[];
  countries: CatalogCountry[];
}

export interface CustomerView {
  id: string;
  email: string;
  givenName: string;
  country: string;
}

/** What the browser does next after an eligibility check. */
export type EligibilityNext = "order" | "due-diligence" | "verification";

export interface EligibilityView {
  paymentReady: boolean;
  requirements: string[];
  next: EligibilityNext;
  /** For "verification": whether the customer can reuse an existing Sumsub verification. */
  kycSharing: boolean;
}

/** How the customer pays for a created order. */
export type PaymentSession =
  | { mode: "native"; nativeToken: string }
  | { mode: "hosted"; checkoutUrl: string }
  | { mode: "bank"; instructions: Record<string, string> }
  | { mode: "mock-native" }
  | { mode: "mock-hosted" };

export interface OrderView {
  id: string;
  status: AppStatus;
  rail: Rail;
  method: MethodId;
  fiat: string;
  fiatAmount: string;
  crypto: string;
  blockchain: string;
  cryptoAmount: string | null;
  walletAddress: string;
  txHash: string | null;
  payment: PaymentSession;
  createdAt: string;
  updatedAt: string;
  /** When this app first saw each status (ISO 8601). */
  statusTimes: Partial<Record<AppStatus, string>>;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
