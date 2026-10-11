import "server-only";
import { authorizationHeader } from "./signing";

/**
 * Minimal client for the Banxa Native API (eapi/v0).
 * The JS SDK doesn't cover these endpoints, so requests are signed here.
 */

export class NativeApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "NativeApiError";
  }
}

export interface NativeClientConfig {
  key: string;
  secret: string;
  environment: "sandbox" | "production";
}

export function createNativeClient({ key, secret, environment }: NativeClientConfig) {
  const origin = environment === "production" ? "https://api.banxa.com" : "https://api.banxa-sandbox.com";

  async function request<T>(method: "GET" | "POST" | "PATCH", path: string, payload?: unknown, unwrap = true): Promise<T> {
    const fullPath = `/eapi/v0${path}`;
    const body = payload === undefined ? undefined : JSON.stringify(payload); // compact JSON, as signed

    // Banxa verifies the signature against the *decoded* path and query (e.g. "@" not "%40"),
    // while the request itself must be sent URL-encoded.
    const signedPath = decodeURIComponent(fullPath);

    const res = await fetch(origin + fullPath, {
      method,
      headers: {
        Authorization: authorizationHeader(key, secret, method, signedPath, body),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }

    if (!res.ok) {
      throw new NativeApiError(`Banxa Native API ${method} ${fullPath} failed with ${res.status}`, res.status, json);
    }
    // Some responses wrap the payload in { data }. Paginated lists keep the wrapper (unwrap: false).
    if (unwrap && json && typeof json === "object" && "data" in json) return (json as { data: T }).data;
    return json as T;
  }

  return {
    get: <T>(path: string, opts?: { unwrap?: boolean }) => request<T>("GET", path, undefined, opts?.unwrap ?? true),
    post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
    patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  };
}

export type NativeClient = ReturnType<typeof createNativeClient>;
