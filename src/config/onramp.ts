/**
 * Display metadata and app capabilities.
 *
 * What Banxa supports (fiats, cryptos, networks, payment methods, limits, countries)
 * is loaded at runtime from the Native API configuration endpoints. See src/modules/catalog.
 * This file only says how to present those things and which payment methods this app can render.
 */

/**
 * Banxa payment methods this app knows how to take payment with, keyed by Banxa method id.
 *   rail "native" → Partner API v2 order + <banxa-primer-checkout>
 *   rail "ramp"   → Native API v0 ramp (bank transfer) + deposit instructions
 * Methods Banxa returns that aren't listed here are hidden.
 */
export const SUPPORTED_METHODS = {
  "debit-credit-card": { kind: "card", primer: "PAYMENT_CARD", rail: "native", label: "Card", meta: "Visa, Mastercard · instant" },
  "apple-pay": { kind: "apple", primer: "APPLE_PAY", rail: "native", label: "Apple Pay", meta: "Safari on Apple devices · instant" },
  "google-pay": { kind: "google", primer: "GOOGLE_PAY", rail: "native", label: "Google Pay", meta: "Chrome and Android · instant" },
  "payid-bank-transfer": { kind: "bank", primer: null, rail: "ramp", label: "PayID", meta: "Bank transfer · usually minutes" },
  "sepa-bank-transfer": { kind: "bank", primer: null, rail: "ramp", label: "SEPA transfer", meta: "Bank transfer · usually 1 business day" },
  "interac-bank-transfer": { kind: "bank", primer: null, rail: "ramp", label: "Interac e-Transfer", meta: "Bank transfer · usually minutes" },
} as const;

export type MethodId = keyof typeof SUPPORTED_METHODS;
export type Rail = (typeof SUPPORTED_METHODS)[MethodId]["rail"];

export const isSupportedMethod = (id: string): id is MethodId => id in SUPPORTED_METHODS;

/** Preferred defaults when Banxa offers them. */
export const DEFAULTS = { fiat: "AUD", crypto: "USDT", method: "debit-credit-card", fiatAmount: 250 } as const;

/** Per-network extras Banxa doesn't provide, including wallet address formats. Unknown networks are validated by Banxa. */
export const NETWORK_META: Record<string, { explorerTxUrl?: string; walletPattern?: RegExp; testWallet?: string }> = {
  TRON: { explorerTxUrl: "https://tronscan.org/#/transaction/", walletPattern: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, testWallet: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE" },
  ETH: { explorerTxUrl: "https://etherscan.io/tx/", walletPattern: /^0x[a-fA-F0-9]{40}$/, testWallet: "0x9f8c163cBA728e99993ABe7495F06c0A3c8Ac8b9" },
  SOL: { explorerTxUrl: "https://solscan.io/tx/", walletPattern: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, testWallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" },
  BTC: { explorerTxUrl: "https://mempool.space/tx/", walletPattern: /^(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/, testWallet: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq" },
  MATIC: { explorerTxUrl: "https://polygonscan.com/tx/", walletPattern: /^0x[a-fA-F0-9]{40}$/, testWallet: "0x9f8c163cBA728e99993ABe7495F06c0A3c8Ac8b9" },
  BSC: { explorerTxUrl: "https://bscscan.com/tx/", walletPattern: /^0x[a-fA-F0-9]{40}$/, testWallet: "0x9f8c163cBA728e99993ABe7495F06c0A3c8Ac8b9" },
};

/**
 * Networks where exchanges need a memo/tag on deposits. This app doesn't collect one, so they're
 * hidden: sending without the tag can lose funds. Add a walletAddressMemo field to offer them.
 */
export const MEMO_NETWORKS = new Set(["XRP", "XLM", "STELLAR", "EOS", "HBAR", "ATOM", "BNB", "TON", "ALGO", "KAVA"]);

/** Coin badge colour/glyph and how many decimals to show. Unknown coins get a neutral badge. */
const CRYPTO_META: Record<string, { color: string; glyph: string; decimals: number }> = {
  USDT: { color: "#26a17b", glyph: "₮", decimals: 2 },
  USDC: { color: "#2775ca", glyph: "$", decimals: 2 },
  BTC: { color: "#f7931a", glyph: "₿", decimals: 8 },
  ETH: { color: "#627eea", glyph: "Ξ", decimals: 6 },
  SOL: { color: "#14b8a6", glyph: "◎", decimals: 4 },
};

export const cryptoMeta = (code: string) => CRYPTO_META[code] ?? { color: "#555", glyph: code.slice(0, 1), decimals: 6 };
