/**
 * Version of the contract shared between apps/web and apps/api.
 *
 * Bump MAJOR for breaking changes to request/response shapes, MINOR for
 * additive changes. The API returns it in the `X-Contract-Version` header and
 * the dashboard warns when its own major version differs.
 */
export const CONTRACT_VERSION = "2.0.0";

/** Version of the structured output format the LLM must return. */
export const EXTRACTION_SCHEMA_VERSION = "extraction-schema/1.0.0";

/** Version of the article extraction (HTML clean-up) logic. */
export const EXTRACTION_VERSION = "extract/2.0.0";

/** Version of the redaction / data-classification policy applied before any external transmission. */
export const REDACTION_POLICY_VERSION = "redaction/1.0.0";

export function contractMajor(v: string): number {
  return Number.parseInt(v.split(".")[0] ?? "0", 10);
}

export function isContractCompatible(serverVersion: string, clientVersion = CONTRACT_VERSION): boolean {
  return contractMajor(serverVersion) === contractMajor(clientVersion);
}
