import "server-only";
import { z } from "zod";

const schema = z
  .object({
    BANXA_MODE: z.enum(["mock", "sandbox", "production"]).default("mock"),
    APP_URL: z.url().default("http://localhost:3000"),
    BANXA_PARTNER: z.string().optional(),
    BANXA_API_KEY: z.string().optional(),
    BANXA_NATIVE_KEY: z.string().optional(),
    BANXA_NATIVE_SECRET: z.string().optional(),
    BANXA_WEBHOOK_SECRET: z.string().optional(),
    BANXA_WEBHOOK_PATH: z.string().startsWith("/").default("/api/webhooks/banxa"),
    NEXT_PUBLIC_MERCHANT_DOMAIN: z.string().optional(),
    DATABASE_PATH: z.string().default("./data/onramp.db"),
    /** "sumsub" lets customers reuse a Sumsub verification from your own KYC (always on in mock mode). */
    KYC_SHARING: z.enum(["none", "sumsub"]).default("none"),
    SUMSUB_APP_TOKEN: z.string().optional(),
    SUMSUB_SECRET_KEY: z.string().optional(),
    SUMSUB_BASE_URL: z.url().default("https://api.sumsub.com"),
    /** Sumsub client id Banxa receives share tokens under. */
    SUMSUB_BANXA_CLIENT_ID: z.string().default("banxa.com_5335"),
    /** Signs session cookies. Required outside mock mode. */
    SESSION_SECRET: z.string().min(32).optional(),
    /** Shared secret for POST /api/sync (scheduled reconciliation). */
    SYNC_SECRET: z.string().optional(),
    MOCK_EDD_THRESHOLD: z.coerce.number().default(200),
    MOCK_VERIFICATION_THRESHOLD: z.coerce.number().default(5000),
  })
  .superRefine((env, ctx) => {
    if (env.BANXA_MODE === "mock") return;
    for (const key of ["BANXA_PARTNER", "BANXA_API_KEY", "BANXA_NATIVE_KEY", "BANXA_NATIVE_SECRET", "SESSION_SECRET"] as const) {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when BANXA_MODE=${env.BANXA_MODE}` });
    }
    if (env.KYC_SHARING === "sumsub") {
      for (const key of ["SUMSUB_APP_TOKEN", "SUMSUB_SECRET_KEY"] as const) {
        if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when KYC_SHARING=sumsub` });
      }
    }
  });

// Empty strings in .env mean "not set".
const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
const parsed = schema.safeParse(raw);

if (!parsed.success) {
  throw new Error(`Invalid environment:\n${parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`);
}

export const env = {
  ...parsed.data,
  /** Secret used to verify Banxa webhooks. */
  webhookSecret: parsed.data.BANXA_WEBHOOK_SECRET ?? parsed.data.BANXA_NATIVE_SECRET ?? "mock_webhook_secret",
  sessionSecret: parsed.data.SESSION_SECRET ?? "mock-mode-session-secret-not-for-real-use",
};

export type BanxaMode = typeof env.BANXA_MODE;
