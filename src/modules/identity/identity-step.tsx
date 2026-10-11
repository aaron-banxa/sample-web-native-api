"use client";

import { useState } from "react";
import { api, ApiRequestError, type IdentityForm } from "@/lib/api";
import type { CustomerView } from "@/lib/types";
import { useCatalog } from "@/components/onramp/catalog-context";
import { Button, Callout } from "@/components/ui/primitives";
import { findCountry } from "@/modules/catalog/lookup";

/** Step 2 · Customer details. Countries come from GET /eapi/v0/countries. The server creates (or reuses) the Banxa identity. */
export function IdentityStep({ mock, onDone }: { mock: boolean; onDone: (customer: CustomerView) => void }) {
  const catalog = useCatalog();
  const { countries } = catalog;
  const [form, setForm] = useState({
    email: mock ? "mia.hargreaves@example.com" : "",
    givenName: mock ? "Mia" : "",
    surname: mock ? "Hargreaves" : "",
    day: mock ? "14" : "",
    month: mock ? "03" : "",
    year: mock ? "1991" : "",
    country: findCountry(catalog, "AU") ? "AU" : (countries[0]?.code ?? ""),
    state: "",
    consent: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Set when the email already belongs to a customer: they must enter the code Banxa emailed.
  const [verifying, setVerifying] = useState<{ email: string; code: string } | null>(null);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const states = countries.find((c) => c.code === form.country)?.states ?? [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const payload: IdentityForm = {
      email: form.email.trim(),
      givenName: form.givenName,
      surname: form.surname,
      dateOfBirth: `${form.year}-${form.month.padStart(2, "0")}-${form.day.padStart(2, "0")}`,
      country: form.country,
      state: states.length ? form.state : undefined,
      consent: form.consent,
    };
    try {
      onDone(await api.register(payload));
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "verify_email") {
        setVerifying({ email: payload.email, code: "" });
        setBusy(false);
        return;
      }
      if (err instanceof ApiRequestError && err.details) {
        setFieldErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      }
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!verifying) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await api.verifyEmail(verifying.email, verifying.code));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  if (verifying) {
    return (
      <form onSubmit={verify} noValidate>
        <h2 className="step-title serif blur-in">Check your email</h2>
        <p className="step-sub blur-in" style={{ "--i": 1 } as React.CSSProperties}>
          {verifying.email} is already registered. Enter the 4-digit code Banxa just sent to it.
        </p>
        <div className="field blur-in" style={{ "--i": 2 } as React.CSSProperties}>
          <label className="label" htmlFor="otp">Code</label>
          <input id="otp" className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={4} autoFocus value={verifying.code} onChange={(e) => setVerifying({ ...verifying, code: e.target.value.replace(/\D/g, "") })} />
          {mock && <p className="hint">Mock mode: the code is 1234.</p>}
        </div>
        {error && <Callout tone="red">{error}</Callout>}
        <Button type="submit" variant="primary" block disabled={verifying.code.length !== 4} busy={busy} busyLabel="Checking">Verify</Button>
        <p className="hint" style={{ justifyContent: "center", marginTop: 10 }}>
          <button type="button" className="link" onClick={() => { setVerifying(null); setError(null); }}>Use a different email</button>
        </p>
      </form>
    );
  }

  const fieldError = (key: string) => fieldErrors[key] && <p className="hint err">{fieldErrors[key]}</p>;

  return (
    <form onSubmit={submit} noValidate>
      <h2 className="step-title serif blur-in">Your details</h2>
      <p className="step-sub blur-in" style={{ "--i": 1 } as React.CSSProperties}>
        Banxa, our crypto partner, needs to verify who you are. You only do this once.
      </p>

      <div className="blur-in" style={{ "--i": 2 } as React.CSSProperties}>
        <div className="field">
          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" value={form.email} onChange={(e) => set({ email: e.target.value })} required />
          {fieldError("email")}
        </div>
        <div className="row">
          <div className="field">
            <label className="label" htmlFor="given">Given name</label>
            <input id="given" className="input" autoComplete="given-name" value={form.givenName} onChange={(e) => set({ givenName: e.target.value })} required />
            {fieldError("givenName")}
          </div>
          <div className="field">
            <label className="label" htmlFor="surname">Surname</label>
            <input id="surname" className="input" autoComplete="family-name" value={form.surname} onChange={(e) => set({ surname: e.target.value })} required />
            {fieldError("surname")}
          </div>
        </div>
        <div className="field">
          <span className="label">Date of birth</span>
          <div className="row-3">
            <input className="input" aria-label="Day" placeholder="DD" inputMode="numeric" maxLength={2} value={form.day} onChange={(e) => set({ day: e.target.value.replace(/\D/g, "") })} />
            <input className="input" aria-label="Month" placeholder="MM" inputMode="numeric" maxLength={2} value={form.month} onChange={(e) => set({ month: e.target.value.replace(/\D/g, "") })} />
            <input className="input" aria-label="Year" placeholder="YYYY" inputMode="numeric" maxLength={4} value={form.year} onChange={(e) => set({ year: e.target.value.replace(/\D/g, "") })} />
          </div>
          {fieldError("dateOfBirth")}
        </div>
        <div className="field">
          <label className="label" htmlFor="country">Country of residence</label>
          <select id="country" className="select" value={form.country} onChange={(e) => set({ country: e.target.value, state: "" })}>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
          {fieldError("country")}
        </div>
        {states.length > 0 && (
          <div className="field">
            <label className="label" htmlFor="state">State</label>
            <select id="state" className="select" value={form.state} onChange={(e) => set({ state: e.target.value })}>
              <option value="">Select</option>
              {states.map((s) => (
                <option key={s.code} value={s.code}>{s.name}</option>
              ))}
            </select>
            {fieldError("state")}
          </div>
        )}
      </div>

      <label className="check blur-in" style={{ "--i": 3 } as React.CSSProperties}>
        <input type="checkbox" checked={form.consent} onChange={(e) => set({ consent: e.target.checked })} />
        <span>
          I agree to Banxa&apos;s{" "}
          <a href="https://banxa.com/terms-of-use/" target="_blank" rel="noreferrer">Terms of Use</a> and{" "}
          <a href="https://banxa.com/privacy-and-cookies-policy/" target="_blank" rel="noreferrer">Privacy Policy</a>, and consent to my details being shared with Banxa for verification.
        </span>
      </label>

      {error && <Callout tone="red">{error}</Callout>}

      <Button type="submit" variant="primary" block disabled={!form.consent} busy={busy} busyLabel="Verifying" className="blur-in" style={{ "--i": 4 } as React.CSSProperties}>
        Continue
      </Button>
    </form>
  );
}
