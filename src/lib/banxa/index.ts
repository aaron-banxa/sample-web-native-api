import "server-only";
import { env } from "@/lib/env";
import type { BanxaGateway } from "./gateway";
import { mockGateway } from "./mock-gateway";
import { createRealGateway } from "./real-gateway";

/** The Banxa gateway for the configured BANXA_MODE. Server-only: holds API credentials. */
export const banxa: BanxaGateway =
  env.BANXA_MODE === "mock"
    ? mockGateway
    : createRealGateway({
        mode: env.BANXA_MODE,
        partner: env.BANXA_PARTNER!,
        apiKey: env.BANXA_API_KEY!,
        nativeKey: env.BANXA_NATIVE_KEY!,
        nativeSecret: env.BANXA_NATIVE_SECRET!,
      });

export const isMock = env.BANXA_MODE === "mock";

export type * from "./gateway";
