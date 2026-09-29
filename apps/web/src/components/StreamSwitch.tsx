import { STREAMS, type Stream } from "@eradigm/shared";

/**
 * Primary / Secondary switch, styled like the other segmented controls. An
 * optional red count sits on the outer top corner of each option (top left
 * for Primary, top right for Secondary) and disappears at zero.
 */
export function StreamSwitch({
  value,
  onChange,
  noun,
  counts,
  label,
}: {
  value: Stream;
  onChange: (s: Stream) => void;
  /** "Inbox", "Tracker", "Phantoms" → "Primary Inbox" / "Secondary Inbox". */
  noun: string;
  counts?: Partial<Record<Stream, number>>;
  label?: string;
}) {
  return (
    <div className="seg stream-switch" role="group" aria-label={label ?? `${noun} to show`}>
      {STREAMS.map((s) => {
        const n = counts?.[s] ?? 0;
        const name = `${s === "primary" ? "Primary" : "Secondary"} ${noun}`;
        return (
          <button key={s} aria-pressed={value === s} onClick={() => onChange(s)} data-testid={`stream-${s}`}>
            {name}
            {n > 0 && (
              <span className={`count-badge ${s === "primary" ? "left" : "right"}`} aria-label={`${n} unprocessed`} data-testid={`count-${s}`}>
                {n > 99 ? "99+" : n}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
