/** Field-level error returned to the client (validation codes, URL policy codes, ...). */
export interface FieldError {
  key: string;
  label: string;
  code: string;
  message: string;
}

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "BAD_REQUEST"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA"
  | "MISCONFIGURED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  BAD_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  MISCONFIGURED: 503,
  INTERNAL: 500,
};

/** Error with a user-safe message. Anything else is reported as a generic 500. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: FieldError[];
  constructor(code: ErrorCode, message: string, fields?: FieldError[]) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.fields = fields;
  }
}

export const notFound = (what = "Item") => new ApiError("NOT_FOUND", `${what} not found`);
export const forbidden = (msg = "You do not have permission to do this") => new ApiError("FORBIDDEN", msg);
export const conflict = (msg: string) => new ApiError("CONFLICT", msg);
export const badRequest = (msg: string) => new ApiError("BAD_REQUEST", msg);
