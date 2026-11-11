import { errorMessage, type FetchLike, TokenProvider } from "./auth.js";
import { BASE_URLS, type LuluConfig, TOKEN_PATH } from "./config.js";
import { LuluApiError, LuluNetworkError } from "./errors.js";
import { VERSION } from "./version.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type QueryValue = string | number | boolean | undefined;

export interface LuluRequest {
  method: HttpMethod;
  /** Path relative to the API host, starting and ending with "/". */
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
}

export interface LuluClientOptions {
  fetch?: FetchLike;
  /** Waits between retries; injectable so tests run instantly. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Statuses worth retrying for requests that are safe to repeat. */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const RETRY_DELAYS_MS = [500, 1500];
const MAX_RETRY_AFTER_MS = 10_000;

/** Thin HTTP client for the Lulu Print API. Returns parsed JSON bodies as-is. */
export class LuluClient {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly tokens: TokenProvider;

  constructor(
    private readonly config: LuluConfig,
    options: LuluClientOptions = {},
  ) {
    this.baseUrl = BASE_URLS[config.environment];
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.tokens = new TokenProvider({
      tokenUrl: `${this.baseUrl}${TOKEN_PATH}`,
      clientKey: config.clientKey,
      clientSecret: config.clientSecret,
      timeoutMs: config.timeoutMs,
      fetch: this.fetchImpl,
      ...(options.now ? { now: options.now } : {}),
    });
  }

  get environment(): LuluConfig["environment"] {
    return this.config.environment;
  }

  /**
   * Sends one request. GET requests are retried on 429/502/503/504 and network
   * errors; other methods never are, so an order is never placed twice.
   * A 401 refreshes the token and retries once, since that request never ran.
   * Login failures throw LuluAuthError before anything is sent.
   */
  async request(req: LuluRequest): Promise<unknown> {
    const url = this.buildUrl(req);
    const canRetry = req.method === "GET";
    let refreshedToken = false;
    let retries = 0;

    for (;;) {
      const token = await this.tokens.getToken();
      let response: Response;
      let body: unknown;
      try {
        response = await this.send(url, req, token);
        if (response.status === 401 && !refreshedToken) {
          await response.body?.cancel();
          refreshedToken = true;
          this.tokens.invalidate();
          continue;
        }
        if (canRetry && RETRYABLE_STATUSES.has(response.status) && retries < RETRY_DELAYS_MS.length) {
          await response.body?.cancel();
          await this.sleep(retryDelay(response, retries));
          retries++;
          continue;
        }
        // Inside the try: a timeout can also fire while the body is still arriving.
        body = await readBody(response);
      } catch (error) {
        if (canRetry && retries < RETRY_DELAYS_MS.length) {
          await this.sleep(RETRY_DELAYS_MS[retries] ?? 0);
          retries++;
          continue;
        }
        const warning = canRetry
          ? ""
          : " The request may or may not have reached Lulu; check before trying again so nothing is done twice.";
        throw new LuluNetworkError(
          `Could not reach Lulu for ${req.method} ${req.path}: ${errorMessage(error).replace(/\.$/, "")}.${warning}`,
          { cause: error },
        );
      }

      if (!response.ok) throw new LuluApiError(response.status, req.method, req.path, body);
      return body;
    }
  }

  private async send(url: URL, req: LuluRequest, token: string): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": `lulu-print-mcp/${VERSION}`,
    };
    const init: RequestInit = {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    };
    if (req.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(req.body);
    }
    return this.fetchImpl(url, init);
  }

  private buildUrl(req: LuluRequest): URL {
    const url = new URL(req.path, this.baseUrl);
    for (const [key, value] of Object.entries(req.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  const seconds = header === null ? Number.NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  return RETRY_DELAYS_MS[attempt] ?? 0;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}
