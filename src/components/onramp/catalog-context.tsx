"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Catalog } from "@/lib/types";

/** Banxa configuration (fiats, cryptos, methods, countries), loaded on the server and shared with every step. */
const CatalogContext = createContext<Catalog | null>(null);

export function CatalogProvider({ catalog, children }: { catalog: Catalog; children: ReactNode }) {
  return <CatalogContext.Provider value={catalog}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): Catalog {
  const catalog = useContext(CatalogContext);
  if (!catalog) throw new Error("useCatalog must be used inside <CatalogProvider>");
  return catalog;
}
