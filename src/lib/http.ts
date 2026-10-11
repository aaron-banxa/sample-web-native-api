import "server-only";
import { BanxaApiError } from "@banxa-official/javascript-native-payments-sdk";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { NativeApiError } from "@/lib/banxa/native-client";

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

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/**
 * Wrap a route handler with consistent error responses.
 * Banxa error bodies are logged server-side and never sent to the browser.
 */
export function route<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
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
        console.warn(`[banxa] ${err.message}`, err.body);
        return NextResponse.json(
          { error: "Banxa can't accept this purchase. It may exceed your limits, or not be available for your age or location." },
          { status: 422 },
        );
      }
      if (err instanceof BanxaApiError && err.statusCode === 422) {
        // Partner API validation (e.g. "The fiat amount '250.00' must be between '5' and '100'.") is safe and useful to show.
        console.warn(`[banxa] ${err.message}`, err.errors ?? err.responseBody);
        const detail = err.errors?.[0]?.message ?? safeValidationMessage(err.responseBody);
        return NextResponse.json({ error: detail ?? "Banxa couldn't accept this order." }, { status: 422 });
      }
      if (err instanceof BanxaApiError || err instanceof NativeApiError) {
        const body = err instanceof BanxaApiError ? (err.errors ?? err.responseBody) : err.body;
        console.error(`[banxa] ${err.message}`, body);
        return NextResponse.json({ error: "Banxa couldn't process this request. Please try again." }, { status: 502 });
      }
      console.error(err);
      return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
  };
}
