import { LuluAuthError } from "./errors.js";

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface TokenProviderOptions {
  tokenUrl: string;
  clientKey: string;
  clientSecret: string;
  timeoutMs: number;
  fetch?: FetchLike;
  /** Clock in milliseconds, injectable for tests. */
  now?: () => number;
}

/** Refresh this long before the token's stated expiry. */
const EXPIRY_MARGIN_MS = 60_000;
/** Used when Lulu omits `expires_in`. */
const DEFAULT_LIFETIME_S = 300;

/**
 * Gets and caches OAuth2 access tokens with the client-credentials grant.
 * Concurrent callers share one in-flight token request.
 */
export class TokenProvider {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private cached: { value: string; expiresAt: number } | undefined;
  private inflight: Promise<string> | undefined;

  constructor(private readonly options: TokenProviderOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
  }

  async getToken(): Promise<string> {
    if (this.cached && this.now() < this.cached.expiresAt - EXPIRY_MARGIN_MS) {
      return this.cached.value;
    }
    this.inflight ??= this.fetchToken().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  /** Drop the cached token, e.g. after the API rejects it with 401. */
  invalidate(): void {
    this.cached = undefined;
  }

  private async fetchToken(): Promise<string> {
    const { clientKey, clientSecret, tokenUrl, timeoutMs } = this.options;
    const basic = Buffer.from(`${clientKey}:${clientSecret}`, "utf8").toString("base64");

    let response: Response;
    try {
      response = await this.fetchImpl(tokenUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new LuluAuthError(
        `Could not reach the Lulu login server: ${errorMessage(error)}`,
        undefined,
        { cause: error },
      );
    }

    if (!response.ok) {
      const hint =
        response.status === 400 || response.status === 401
          ? " Check LULU_CLIENT_KEY and LULU_CLIENT_SECRET, and that LULU_ENVIRONMENT matches the keys: sandbox and production use different keys."
          : "";
      throw new LuluAuthError(
        `Lulu rejected the API credentials (HTTP ${response.status}).${hint}`,
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new LuluAuthError("Lulu's login server returned a response that is not JSON.", response.status, {
        cause: error,
      });
    }
    if (!isRecord(payload) || typeof payload.access_token !== "string" || payload.access_token === "") {
      throw new LuluAuthError("Lulu's login server response has no access_token.", response.status);
    }
    const lifetime =
      typeof payload.expires_in === "number" && payload.expires_in > 0
        ? payload.expires_in
        : DEFAULT_LIFETIME_S;

    this.cached = { value: payload.access_token, expiresAt: this.now() + lifetime * 1000 };
    return payload.access_token;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
