import "server-only";
import { BanxaApiError } from "@banxa-official/javascript-native-payments-sdk";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { NativeApiError } from "@/lib/banxa/native-client";
import { env } from "@/lib/env";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Request is well-formed but not allowed (e.g. amount outside Banxa's limits). */
export class ValidationError extends Error {
  constructor(readonly details: { path: string; message: string }[]) {
    super(details[0]?.message ?? "Invalid request");
  }
}

/** First field message from a Banxa validation body: { message, errors: { field: [msg] } }. */
function safeValidationMessage(body?: string): string | undefined {
  try {
    const parsed = JSON.parse(body ?? "") as { errors?: Record<string, string[]> };
    const first = parsed.errors && Object.values(parsed.errors)[0]?.[0];
    return typeof first === "string" ? first.replace(/'/g, "") : undefined;
  } catch {
    return undefined;
  }
}

/** For logs: Banxa error bodies can echo customer details. Mask emails and cap the length. */
const redact = (value: unknown) =>
  (typeof value === "string" ? value : JSON.stringify(value ?? "")).replace(/[^\s"'@,:]+@[^\s"'@,]+/g, "[email]").slice(0, 500);

/**
 * Cross-site request check for state-changing requests. Browsers send Origin on POST/PUT/DELETE;
 * it must be this app. Server-to-server callers (cron, Banxa) send none and are authenticated otherwise.
 */
function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin === new URL(env.APP_URL).origin || new URL(origin).host === host) return;
  throw new HttpError(403, "Cross-site request blocked");
}

/** Read a JSON object body. Requiring the JSON content type also stops cross-site HTML form posts. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new HttpError(415, "Expected a JSON body");
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Expected a JSON object");
  return body as Record<string, unknown>;
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/**
 * Wrap a route handler with consistent error responses and the cross-site check.
 * Banxa error bodies are logged server-side (redacted) and never sent to the browser.
 */
export function route<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      assertSameOrigin(req);
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ZodError) {
        return NextResponse.json({ error: "Invalid request", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
      }
      if (err instanceof ValidationError) {
        return NextResponse.json({ error: err.message, details: err.details }, { status: 400 });
      }
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      if (err instanceof NativeApiError && err.statusCode === 422) {
        // Restrictions such as limit breaches, age or location. Banxa's detail is logged, not shown.
        console.warn(`[banxa] ${err.message}`, redact(err.body));
        return NextResponse.json(
          { error: "Banxa can't accept this purchase. It may exceed your limits, or not be available for your age or location." },
          { status: 422 },
        );
      }
      if (err instanceof BanxaApiError && err.statusCode === 422) {
        // Partner API validation (e.g. "The fiat amount '250.00' must be between '5' and '100'.") is safe and useful to show.
        console.warn(`[banxa] ${err.message}`, redact(err.errors ?? err.responseBody));
        const detail = err.errors?.[0]?.message ?? safeValidationMessage(err.responseBody);
        return NextResponse.json({ error: detail ?? "Banxa couldn't accept this order." }, { status: 422 });
      }
      if (err instanceof BanxaApiError || err instanceof NativeApiError) {
        const body = err instanceof BanxaApiError ? (err.errors ?? err.responseBody) : err.body;
        console.error(`[banxa] ${err.message}`, redact(body));
        return NextResponse.json({ error: "Banxa couldn't process this request. Please try again." }, { status: 502 });
      }
      console.error(err);
      return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
  };
}
