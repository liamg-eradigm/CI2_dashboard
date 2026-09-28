/**
 * Lifecycle of an intelligence item (4_Backend_Design: "Every item must have
 * one clear status").
 */
export const ITEM_STATUSES = [
  "queued",
  "fetching",
  "extracting",
  "needs_review",
  "approved",
  "rejected",
  "failed",
  "deleted",
] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const STATUS_LABEL: Record<ItemStatus, string> = {
  queued: "Queued",
  fetching: "Fetching",
  extracting: "Extracting",
  needs_review: "Needs review",
  approved: "Approved",
  rejected: "Rejected",
  failed: "Failed",
  deleted: "Deleted",
};

/** Text glyph shown alongside the colour so status never relies on colour alone. */
export const STATUS_GLYPH: Record<ItemStatus, string> = {
  queued: "◷",
  fetching: "↓",
  extracting: "⚙",
  needs_review: "●",
  approved: "✓",
  rejected: "✕",
  failed: "!",
  deleted: "⌫",
};

/**
 * Allowed transitions. Any transition not listed here is rejected by the API.
 * `approved -> approved` is a published revision (re-publication of an edit).
 */
export const TRANSITIONS: Record<ItemStatus, readonly ItemStatus[]> = {
  queued: ["fetching", "failed", "deleted"],
  fetching: ["extracting", "failed", "deleted"],
  extracting: ["needs_review", "failed", "deleted"],
  needs_review: ["approved", "rejected", "queued", "deleted"],
  approved: ["approved", "deleted"],
  rejected: ["queued", "deleted"],
  failed: ["queued", "deleted"],
  deleted: [],
};

export function canTransition(from: ItemStatus, to: ItemStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Statuses in which the processing pipeline is still working on the item. */
export const IN_PROGRESS_STATUSES: readonly ItemStatus[] = ["queued", "fetching", "extracting"];

/** Only approved items may ever appear on the client dashboard or in summary results. */
export const PUBLISHED_STATUS: ItemStatus = "approved";
