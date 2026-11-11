/** Base class for every error this package throws. */
export class LuluError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Missing or invalid configuration (environment variables). */
export class LuluConfigError extends LuluError {}

/** Lulu refused the client key and secret, or the token endpoint misbehaved. */
export class LuluAuthError extends LuluError {
  constructor(
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** The request never got a response (DNS, TLS, timeout, connection reset). */
export class LuluNetworkError extends LuluError {}

const MAX_DETAIL_LENGTH = 4000;

/** Lulu answered with a non-2xx status. `body` holds the parsed response. */
export class LuluApiError extends LuluError {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: unknown,
  ) {
    super(`Lulu API returned HTTP ${status} for ${method} ${path}: ${describeBody(body)}`);
  }
}

function describeBody(body: unknown): string {
  if (body === null || body === undefined || body === "") return "(empty response body)";
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}… (truncated)` : text;
}
