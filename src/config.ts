import { LuluConfigError } from "./errors.js";

export type LuluEnvironment = "sandbox" | "production";

/** API hosts, from the `servers` list in Lulu's OpenAPI spec. */
export const BASE_URLS: Readonly<Record<LuluEnvironment, string>> = {
  production: "https://api.lulu.com",
  sandbox: "https://api.sandbox.lulu.com",
};

/** OAuth2 client-credentials token path, from the spec's `securitySchemes`. */
export const TOKEN_PATH = "/auth/realms/glasstree/protocol/openid-connect/token";

export const DEFAULT_TIMEOUT_MS = 30_000;
/** Largest delay Node's timers support; anything bigger fires immediately. */
export const MAX_TIMEOUT_MS = 2_147_483_647;

export interface LuluConfig {
  clientKey: string;
  clientSecret: string;
  environment: LuluEnvironment;
  timeoutMs: number;
}

/**
 * Reads configuration from environment variables.
 *
 * - `LULU_CLIENT_KEY` and `LULU_CLIENT_SECRET` (required)
 * - `LULU_ENVIRONMENT`: `sandbox` (default) or `production`
 * - `LULU_TIMEOUT_MS`: per-request timeout, default 30000
 *
 * Sandbox is the default so that nobody places a real, paid order by accident.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): LuluConfig {
  const clientKey = env.LULU_CLIENT_KEY?.trim();
  const clientSecret = env.LULU_CLIENT_SECRET?.trim();
  const missing = [
    clientKey ? undefined : "LULU_CLIENT_KEY",
    clientSecret ? undefined : "LULU_CLIENT_SECRET",
  ].filter((name): name is string => name !== undefined);
  if (missing.length > 0 || !clientKey || !clientSecret) {
    throw new LuluConfigError(
      `Missing ${missing.join(" and ")}. Get API keys from https://developers.lulu.com/ ` +
        "(production) or https://developers.sandbox.lulu.com/ (sandbox).",
    );
  }

  const rawEnvironment = (env.LULU_ENVIRONMENT ?? "sandbox").trim().toLowerCase();
  if (rawEnvironment !== "sandbox" && rawEnvironment !== "production") {
    throw new LuluConfigError(
      `LULU_ENVIRONMENT must be "sandbox" or "production", got "${rawEnvironment}".`,
    );
  }

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (env.LULU_TIMEOUT_MS !== undefined && env.LULU_TIMEOUT_MS.trim() !== "") {
    timeoutMs = Number(env.LULU_TIMEOUT_MS);
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
      throw new LuluConfigError(
        `LULU_TIMEOUT_MS must be a whole number of milliseconds from 1 to ${MAX_TIMEOUT_MS}, got "${env.LULU_TIMEOUT_MS}".`,
      );
    }
  }

  return { clientKey, clientSecret, environment: rawEnvironment, timeoutMs };
}
