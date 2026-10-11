"use client";

import { createContext, use, type ReactNode } from "react";
import type { Catalog } from "@/lib/types";

export type RunMode = "mock" | "sandbox" | "production";

interface OnrampContextValue {
  /** Banxa configuration (fiats, cryptos, methods, countries), loaded on the server. */
  catalog: Catalog;
  mode: RunMode;
  /** Domain registered with Banxa for Apple Pay. */
  merchantDomain?: string;
}

/** What every step needs to know about this deployment. Steps read it here instead of taking it as props. */
const OnrampContext = createContext<OnrampContextValue | null>(null);

export function OnrampProvider({ children, ...value }: OnrampContextValue & { children: ReactNode }) {
  return <OnrampContext value={value}>{children}</OnrampContext>;
}

function useOnramp(): OnrampContextValue {
  const value = use(OnrampContext);
  if (!value) throw new Error("Onramp hooks must be used inside <OnrampProvider>");
  return value;
}

export const useCatalog = (): Catalog => useOnramp().catalog;

export function useRunMode() {
  const { mode, merchantDomain } = useOnramp();
  return { mode, mock: mode === "mock", merchantDomain };
}

/** Renders its children only in mock mode: test data hints, simulate buttons. */
export function MockOnly({ children }: { children: ReactNode }) {
  return useRunMode().mock ? children : null;
}
