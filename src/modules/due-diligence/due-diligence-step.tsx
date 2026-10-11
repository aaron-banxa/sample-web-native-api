"use client";

import { useState } from "react";
import { api, type DueDiligenceAnswers } from "@/lib/api";
import type { EligibilityView, OrderDraft } from "@/lib/types";
import { useCatalog } from "@/components/onramp/catalog-context";
import { Button, Callout } from "@/components/ui/primitives";
import { findCountry } from "@/modules/catalog/lookup";
import { OCCUPATION_INDUSTRIES, OCCUPATIONS_BY_INDUSTRY, PURPOSES, SOURCES_OF_FUNDS, TAX_ID_TYPES } from "./options";

interface Props {
  requirements: string[];
  draft: OrderDraft;
  /** Customer's country of residence; the address must be there. */
  country: string;
  onResult: (result: EligibilityView) => void;
}

type Address = NonNullable<DueDiligenceAnswers["residentialAddress"]>;

/** Step 4 · Enhanced due diligence. Only the fields Banxa asked for are shown. */
export function DueDiligenceStep({ requirements, draft, country, onResult }: Props) {
  const catalog = useCatalog();
  const states = findCountry(catalog, country)?.states ?? [];
  const [answers, setAnswers] = useState<DueDiligenceAnswers>({});
  const [address, setAddress] = useState<Address>({ addressLine: "", suburb: "", state: "", postCode: "", country });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needs = (r: string) => requirements.includes(r);
  const set = (patch: DueDiligenceAnswers) => setAnswers((a) => ({ ...a, ...patch }));

  const done: Record<string, boolean> = {
    OCCUPATION: !!answers.occupationIndustry && !!answers.occupation,
    SOURCE_FUNDS: !!answers.sourceOfFunds,
    PURPOSE_OF_TX: !!answers.purposeOfTransaction,
    TIN: !!answers.taxIdType && (answers.taxId?.trim().length ?? 0) >= 4,
    ADDRESS: !!address.addressLine.trim() && !!address.suburb.trim() && address.state.trim().length >= 2 && address.postCode.trim().length >= 3,
  };
  const occupations = answers.occupationIndustry ? OCCUPATIONS_BY_INDUSTRY[answers.occupationIndustry as keyof typeof OCCUPATIONS_BY_INDUSTRY] : [];
  const complete = requirements.every((r) => done[r]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onResult(await api.dueDiligence({ ...answers, ...(needs("ADDRESS") ? { residentialAddress: address } : {}) }, draft));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h2 className="step-title serif blur-in">A few more details</h2>
      <p className="step-sub blur-in" style={{ "--i": 1 } as React.CSSProperties}>
        Required by anti-money-laundering rules for this order. You&apos;ll only be asked once.
      </p>
      <div className="chips blur-in" style={{ "--i": 2, marginBottom: 16 } as React.CSSProperties}>
        {requirements.map((r) => (
          <span key={r} className={`req-chip${done[r] ? " done" : ""}`}>{r}</span>
        ))}
      </div>

      <div className="blur-in" style={{ "--i": 3 } as React.CSSProperties}>
        {needs("ADDRESS") && (
          <>
            <div className="field">
              <label className="label" htmlFor="address-line">Residential address</label>
              <input id="address-line" className="input" autoComplete="address-line1" placeholder="Street number and name" value={address.addressLine} onChange={(e) => setAddress({ ...address, addressLine: e.target.value })} />
            </div>
            <div className="row">
              <div className="field">
                <label className="label" htmlFor="suburb">Suburb or city</label>
                <input id="suburb" className="input" autoComplete="address-level2" value={address.suburb} onChange={(e) => setAddress({ ...address, suburb: e.target.value })} />
              </div>
              <div className="field">
                <label className="label" htmlFor="postcode">Postcode</label>
                <input id="postcode" className="input" autoComplete="postal-code" value={address.postCode} onChange={(e) => setAddress({ ...address, postCode: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="addr-state">State or region</label>
              {states.length ? (
                <select id="addr-state" className="select" value={address.state} onChange={(e) => setAddress({ ...address, state: e.target.value })}>
                  <option value="">Select</option>
                  {states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                </select>
              ) : (
                <input id="addr-state" className="input" autoComplete="address-level1" placeholder="e.g. VIC" maxLength={3} value={address.state} onChange={(e) => setAddress({ ...address, state: e.target.value.toUpperCase() })} />
              )}
            </div>
          </>
        )}

        {needs("OCCUPATION") && (
          <div className="row">
            <div className="field">
              <label className="label" htmlFor="industry">Industry</label>
              <select id="industry" className="select" value={answers.occupationIndustry ?? ""} onChange={(e) => set({ occupationIndustry: e.target.value || undefined, occupation: undefined })}>
                <option value="">Select</option>
                {OCCUPATION_INDUSTRIES.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="occupation">Occupation</label>
              <select id="occupation" className="select" value={answers.occupation ?? ""} disabled={!answers.occupationIndustry} onChange={(e) => set({ occupation: e.target.value || undefined })}>
                <option value="">{answers.occupationIndustry ? "Select" : "Choose an industry first"}</option>
                {occupations.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>
        )}

        {needs("SOURCE_FUNDS") && (
          <div className="field">
            <label className="label" htmlFor="funds">Where does the money come from?</label>
            <select id="funds" className="select" value={answers.sourceOfFunds ?? ""} onChange={(e) => set({ sourceOfFunds: e.target.value || undefined })}>
              <option value="">Select</option>
              {SOURCES_OF_FUNDS.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
        )}

        {needs("PURPOSE_OF_TX") && (
          <div className="field">
            <label className="label" htmlFor="purpose">Purpose of this purchase</label>
            <select id="purpose" className="select" value={answers.purposeOfTransaction ?? ""} onChange={(e) => set({ purposeOfTransaction: e.target.value || undefined })}>
              <option value="">Select</option>
              {PURPOSES.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
        )}

        {needs("TIN") && (
          <div className="row">
            <div className="field">
              <label className="label" htmlFor="tin-type">Tax ID type</label>
              <select id="tin-type" className="select" value={answers.taxIdType ?? ""} onChange={(e) => set({ taxIdType: e.target.value || undefined })}>
                <option value="">Select</option>
                {TAX_ID_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="tin">Tax ID number</label>
              <input id="tin" className="input mono" autoComplete="off" value={answers.taxId ?? ""} onChange={(e) => set({ taxId: e.target.value })} />
            </div>
          </div>
        )}
      </div>

      {error && <Callout tone="red">{error}</Callout>}

      <Button type="submit" variant="primary" block disabled={!complete} busy={busy} busyLabel="Submitting" className="blur-in" style={{ "--i": 4 } as React.CSSProperties}>
        Submit details
      </Button>
    </form>
  );
}
