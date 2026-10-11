import { CatalogProvider } from "@/components/onramp/catalog-context";
import { OnrampWidget } from "@/components/onramp/widget";
import { env } from "@/lib/env";
import type { Catalog } from "@/lib/types";
import { getCatalog } from "@/modules/catalog/server";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const { order } = await searchParams;
  const mode = env.BANXA_MODE;

  // Supported fiats, cryptos, payment methods and countries, from the Banxa Native API.
  let catalog: Catalog | null = null;
  try {
    catalog = await getCatalog();
  } catch (err) {
    console.error("[catalog] could not load Banxa configuration", err);
  }
  const usable = catalog && catalog.fiats.length > 0 && catalog.cryptos.length > 0;

  return (
    <>
      <div className="ambient" aria-hidden="true" />
      <header className="nav">
        <a className="brand" href="/">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="1" y="1" width="22" height="22" rx="6" fill="#111" />
            <path d="M7 15.5 12 8l5 7.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9.5 17h5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Onramp
        </a>
        {mode !== "production" && (
          <span className={`tag ${mode === "mock" ? "yellow" : ""}`}>
            <span className="dot" />
            {mode === "mock" ? "Mock mode" : "Sandbox"}
          </span>
        )}
      </header>
      <main className="stage">
        {usable ? (
          <CatalogProvider catalog={catalog!}>
            <OnrampWidget mode={mode} initialOrderId={order} merchantDomain={env.NEXT_PUBLIC_MERCHANT_DOMAIN} />
          </CatalogProvider>
        ) : (
          <div className="widget">
            <div className="widget-body center">
              <h2 className="step-title serif">Temporarily unavailable</h2>
              <p className="step-sub">We couldn&apos;t load supported currencies from Banxa. Please refresh in a moment.</p>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
