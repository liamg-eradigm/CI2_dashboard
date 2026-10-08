/**
 * Request 47: the size of titles outside the text boxes — each entry's Title
 * and the section headings — changed with A− / A+ by staff and saved for
 * everyone (settings `textSizes`). The buttons show while the title is
 * hovered or focused; sizes step through TITLE_SIZE_STEPS.
 */
import { useRef, type CSSProperties, type ElementType, type InputHTMLAttributes, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { can, stepTitleSize, type TenantSettings } from "@eradigm/shared";
import { api, type ApiError } from "../api/client";
import { useMe, useSettings } from "../api/hooks";
import { useToast } from "../state/toast";

/** What the Title of every entry is sized under. */
export const ENTRY_TITLE = "entry-title";

/** A title's size (1 = as designed), whether this user may change it, and a step up or down. */
export function useTextSize(key: string) {
  const settings = useSettings().data;
  const me = useMe().data;
  const qc = useQueryClient();
  const toast = useToast();
  const latest = useRef(0);
  const size = settings?.textSizes?.[key] ?? 1;
  const canEdit = !!me && can(me.role, "item:edit");
  const step = async (dir: 1 | -1) => {
    const next = stepTitleSize(size, dir);
    if (next === size) return;
    const before = qc.getQueryData<TenantSettings>(["settings"]);
    const put = (s: TenantSettings | undefined, v: number) => {
      if (!s) return s;
      const textSizes = { ...s.textSizes };
      if (v === 1) delete textSizes[key];
      else textSizes[key] = v;
      return { ...s, textSizes };
    };
    // Shown at once; the saved settings follow (only the last press counts).
    qc.setQueryData<TenantSettings | undefined>(["settings"], (s) => put(s, next));
    const n = ++latest.current;
    try {
      const saved = await api<TenantSettings>("/api/settings/text-size", { method: "PUT", json: { key, size: next } });
      if (n === latest.current) qc.setQueryData(["settings"], saved);
    } catch (e) {
      if (n === latest.current) qc.setQueryData<TenantSettings | undefined>(["settings"], (s) => put(s, before?.textSizes?.[key] ?? 1));
      toast((e as ApiError).message, false);
    }
  };
  return { size, canEdit, step };
}

/** The style that scales a title's text (em of the size it has by design). */
export const sizeStyle = (size: number): CSSProperties | undefined => (size === 1 ? undefined : { fontSize: `${size}em` });

/** A− / A+ for one title, with its size; only for staff. */
export function TextSizeButtons({ sizeKey, label, className = "" }: { sizeKey: string; label: string; className?: string }) {
  const { size, canEdit, step } = useTextSize(sizeKey);
  if (!canEdit) return null;
  return (
    <span className={`ts-btns ${className}`.trim()} role="group" aria-label={`Size of ${label}`} data-testid={`ts-${sizeKey}`}>
      <button type="button" className="ts-btn" onClick={() => step(-1)} aria-label={`Smaller ${label}`} title={`Smaller ${label} (for everyone)`} data-testid="ts-smaller">
        A−
      </button>
      <span className="ts-pct" aria-live="polite">
        {Math.round(size * 100)}%
      </span>
      <button type="button" className="ts-btn" onClick={() => step(1)} aria-label={`Larger ${label}`} title={`Larger ${label} (for everyone)`} data-testid="ts-larger">
        A+
      </button>
    </span>
  );
}

/**
 * A heading whose size staff can change. The text is scaled inside the
 * heading (so it keeps its own look); the buttons sit beside it, outside the
 * heading, so its name stays its text.
 */
export function SizedHeading({
  as: Tag = "h2",
  sizeKey,
  label,
  id,
  className,
  style,
  children,
  rowClassName = "",
}: {
  as?: ElementType;
  sizeKey: string;
  /** What the buttons call it ("the AI Summary heading"). */
  label: string;
  id?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  rowClassName?: string;
}) {
  const { size } = useTextSize(sizeKey);
  return (
    <div className={`ts-row ${rowClassName}`.trim()}>
      <Tag id={id} className={className} style={style} data-size={size === 1 ? undefined : size}>
        <span className="ts-text" style={sizeStyle(size)}>
          {children}
        </span>
      </Tag>
      <TextSizeButtons sizeKey={sizeKey} label={label} />
    </div>
  );
}

/** An entry's Title box, its text at the entry-title size. */
export function EntryTitleInput({ className = "", style, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const { size } = useTextSize(ENTRY_TITLE);
  return <input {...props} className={`${className} ts-title-input`.trim()} style={{ ...style, ["--ts" as string]: String(size) }} data-size={size === 1 ? undefined : size} />;
}
