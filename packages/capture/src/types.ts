export interface CaptureStep {
  label: string;
  ok: boolean;
  detail: string;
}

/** Why a capture stopped. `retryable` failures can be retried safely. */
export type CaptureFailureCode =
  | "URL_REJECTED"
  | "DESTINATION_BLOCKED"
  | "DNS_FAILED"
  | "TOO_MANY_REDIRECTS"
  | "TIMEOUT"
  | "TOO_LARGE"
  | "CONTENT_TYPE"
  | "HTTP_ERROR"
  | "ACCESS_RESTRICTED"
  | "ROBOTS_DISALLOWED"
  | "MALICIOUS_CONTENT"
  | "NETWORK"
  | "BROWSER_UNAVAILABLE";

export interface CaptureFailure {
  ok: false;
  code: CaptureFailureCode;
  message: string;
  retryable: boolean;
  /** Index of the pipeline step that failed. */
  stepIndex: number;
  steps: CaptureStep[];
  finalUrl: string | null;
}

export interface Article {
  headline: string;
  bodyText: string;
  publicationDate: string | null;
  siteName: string | null;
  byline: string | null;
  wordCount: number;
  truncated: boolean;
}

export interface SingleFileInfo {
  detected: boolean;
  sourceUrl: string | null;
  savedAt: string | null;
}

export interface ScanResult {
  malicious: boolean;
  reasons: string[];
  scriptsRemoved: number;
  formsRemoved: number;
  framesRemoved: number;
  handlersRemoved: number;
  linksRemoved: number;
}

export interface CaptureSuccess {
  ok: true;
  /** Sanitised snapshot HTML (scripts, trackers, forms and handlers stripped). */
  html: string;
  rawSha256: string;
  rawBytes: number;
  contentType: string;
  httpStatus: number | null;
  finalUrl: string | null;
  redirects: number;
  method: "fetch" | "container" | "upload";
  article: Article;
  singleFile: SingleFileInfo;
  scan: ScanResult;
  warnings: string[];
  steps: CaptureStep[];
  durationMs: number;
}

export type CaptureResult = CaptureSuccess | CaptureFailure;
