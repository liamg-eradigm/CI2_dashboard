/**
 * Client Inbox: the entries Eradigm sent to the client to check. Laid out
 * like the Eradigm Inbox, read-only, with two choices: Send to Eradigm (back
 * to the Eradigm Inbox, with any comments) or Push to Tracker. Highlight any
 * text to comment on it, like comments in Word.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CORE, FIELDS, PAGE_TEXT_FIELD, STREAM_LABEL, can, displayValue, flattenKiqs, kiqsFromValues, primarySourceKey, sortedColumns, type ItemDetail, type ItemSummary, type Me, type TrackerSchema } from "@eradigm/shared";
import { api, type ApiError } from "../api/client";
import { useClientInbox, useComments, useInvalidate, usePrimarySources, useSchema } from "../api/hooks";
import { CommentableText, CommentsMargin, useCommentNumbers } from "../components/Comments";
import { KIQ_KEYS, kiqFieldLabel, kiqLabels } from "../components/KiqEditor";
import { PriorFlag } from "../components/PriorFlag";
import { SnapshotActions } from "../components/SnapshotFrame";
import { localDateTime } from "../lib/format";
import { useToast } from "../state/toast";

export function ClientInboxPage({ me }: { me: Me }) {
  const list = useClientInbox();
  const primary = useSchema("primary");
  const secondary = useSchema("secondary");
  const items = list.data ?? [];
  const schemaOf = (it: ItemSummary) => (it.stream === "primary" ? primary.data : secondary.data);
  return (
    <>
      <section className="band" aria-labelledby="page-title">
        <div className="band-row">
          <div>
            <span className="eyebrow">
              {me.tenant.name} · {items.length} to check
            </span>
            <h1 id="page-title">Client Inbox</h1>
          </div>
          <div className="band-copy">
            Entries Eradigm would like you to check before they go into the Tracker. Highlight any text to leave a comment on it, then send the entry back to Eradigm, or push it to the Tracker as it stands.
          </div>
        </div>
      </section>
      <div className="content" style={{ gap: 14 }}>
        {list.isLoading && <div className="skeleton" style={{ height: 120 }} />}
        {list.isError && (
          <div className="banner err" role="alert">
            {(list.error as Error).message}
          </div>
        )}
        {items.map((it) => {
          const s = schemaOf(it);
          return s ? <ClientCard key={it.id} item={it} schema={s} me={me} /> : null;
        })}
        {list.data && !items.length && <div className="empty">Nothing to check right now. Entries Eradigm sends you appear here.</div>}
      </div>
    </>
  );
}

function ClientCard({ item, schema, me }: { item: ItemSummary; schema: TrackerSchema; me: Me }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);
  const toast = useToast();
  const inv = useInvalidate();
  const canAct = can(me.role, "clientInbox:act");
  const comments = useComments(item.id);
  const detail = useQuery({ queryKey: ["client-inbox", "item", item.id], queryFn: () => api<ItemDetail>(`/api/client-inbox/${item.id}`), enabled: showText });
  // The ID is filled in automatically; Primary topics and questions are shown as their list.
  const primary = item.stream === "primary";
  const cols = sortedColumns(schema).filter((c) => c.key !== CORE.title && c.key !== FIELDS.id && !(primary && KIQ_KEYS.includes(c.key)));
  const topics = primary ? (item.kiqs ?? kiqsFromValues(item.draft)) : [];
  const L = kiqLabels(schema);
  const kiqFields = topics.flatMap((t, ti) => [`_kiq.${ti}.topic`, ...t.kiqs.flatMap((_, ki) => ["question", "details", "metrics"].map((p) => `_kiq.${ti}.${ki}.${p}`))]);
  const all = comments.data ?? [];
  const order = [CORE.title, ...cols.map((c) => c.key), ...kiqFields, PAGE_TEXT_FIELD];
  const { numberOf } = useCommentNumbers(all, order);
  const labelOf = (f: string) => (f === PAGE_TEXT_FIELD ? "Page text" : (kiqFieldLabel(f, schema) ?? schema.columns.find((c) => c.key === f)?.label ?? f));
  const of = (f: string) => all.filter((c) => c.field === f);
  const text = (k: string) => displayValue(schema.columns.find((c) => c.key === k), item.draft[k]);
  const title = text(CORE.title) || item.title || "Untitled";

  const rows = primary ? flattenKiqs(topics) : [];
  // The same source as Primary entries already in the Tracker (request 27).
  const sources = usePrimarySources(primary);
  const sourceKey = primary ? primarySourceKey(item.draft[FIELDS.sourceRole], item.draft[FIELDS.sourceCompany]) : null;
  const prior = sourceKey ? (sources.data ?? []).filter((x) => x.key === sourceKey) : [];
  const act = async (path: "send-to-eradigm" | "push", ok: string) => {
    if (path === "push" && !window.confirm(rows.length > 1 ? `Push “${title}” to the Tracker as ${rows.length} entries, one per ${L.question}?` : `Push “${title}” to the Tracker as it stands?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      if (path === "push" && rows.length > 1) {
        // One Tracker entry per Key Intelligence Question.
        const parts = await api<ItemSummary[]>(`/api/items/${item.id}/split`, { method: "POST", json: { version: item.version, kiqs: topics } });
        for (const p of parts) await api(`/api/client-inbox/${p.id}/push`, { method: "POST", json: { version: p.version } });
      } else await api(`/api/client-inbox/${item.id}/${path}`, { method: "POST", json: { version: item.version } });
      toast(ok);
      await inv("client-inbox", "items", "tracker", "dashboard", "megatrends", "competitors", "bounds");
    } catch (e) {
      setMsg((e as ApiError).message);
      setBusy(false);
    }
  };

  return (
    <section className="inbox-card client-card" aria-labelledby={`t-${item.id}`} data-testid="client-card">
      <div className="inbox-head">
        <div style={{ minWidth: 0, gridColumn: "1 / 3" }}>
          <div className="inbox-meta">
            <span className="code">{item.code}</span>
            <span aria-hidden="true">·</span>
            <span className={`tag ${item.stream === "primary" ? "info" : "ok"}`}>{STREAM_LABEL[item.stream]}</span>
            <span aria-hidden="true">·</span>
            <span>{item.outlet ?? "Source"}</span>
            {item.sentToClient && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Sent by {item.sentToClient.by} · {localDateTime(item.sentToClient.at)}
                </span>
              </>
            )}
            {all.filter((c) => !c.resolved).length > 0 && <span className="tag warn">💬 {all.filter((c) => !c.resolved).length} comment{all.filter((c) => !c.resolved).length === 1 ? "" : "s"}</span>}
          </div>
          <div className="inbox-title" id={`t-${item.id}`}>
            {title}
          </div>
        </div>
        {prior.length > 0 && (
          <div style={{ gridColumn: "1 / -1" }}>
            <PriorFlag code={item.code} role={String(item.draft[FIELDS.sourceRole] ?? "")} company={String(item.draft[FIELDS.sourceCompany] ?? "")} prior={prior} />
          </div>
        )}
        {canAct && (
          <div className="inbox-actions">
            <button className="btn secondary" disabled={busy} onClick={() => void act("send-to-eradigm", `${item.code} sent back to Eradigm`)}>
              ↩ Send to Eradigm
            </button>
            <button className="btn" style={{ height: 38, padding: "0 18px", fontSize: 14 }} disabled={busy} onClick={() => void act("push", `${item.code} pushed to the Tracker`)}>
              ✓ Push to Tracker
            </button>
          </div>
        )}
      </div>
      {msg && (
        <div className="err-msg" role="alert" style={{ padding: "0 20px" }}>
          <b>✕ {msg}</b>
        </div>
      )}
      <div className="client-body">
        <div className="client-fields" role="group" aria-label={`Fields of ${item.code}`}>
          <CommentableText itemId={item.id} field={CORE.title} label={labelOf(CORE.title)} text={text(CORE.title)} comments={of(CORE.title)} numberOf={numberOf} canComment={canAct} />
          <div className="client-grid">
            {cols.map((c) => (
              <div key={c.key} className={c.type === "long" ? "full" : ""}>
                <CommentableText itemId={item.id} field={c.key} label={c.label} text={text(c.key)} comments={of(c.key)} numberOf={numberOf} canComment={canAct} />
              </div>
            ))}
          </div>
          {primary && (
            <div className="client-kiqs" role="group" aria-label={`${L.topic}s and ${L.question}s`}>
              {topics.map((t, ti) => (
                <div className="kiq-topic" key={ti}>
                  <CommentableText itemId={item.id} field={`_kiq.${ti}.topic`} label={`${L.topic} ${ti + 1}`} text={t.topic} comments={of(`_kiq.${ti}.topic`)} numberOf={numberOf} canComment={canAct} />
                  {t.kiqs.map((k, ki) => (
                    <div className="kiq" key={ki}>
                      <CommentableText itemId={item.id} field={`_kiq.${ti}.${ki}.question`} label={`${L.question} ${ki + 1}`} text={k.question} comments={of(`_kiq.${ti}.${ki}.question`)} numberOf={numberOf} canComment={canAct} />
                      <div className="kiq-parts">
                        <CommentableText itemId={item.id} field={`_kiq.${ti}.${ki}.details`} label={L.details} text={k.details} comments={of(`_kiq.${ti}.${ki}.details`)} numberOf={numberOf} canComment={canAct} />
                        <CommentableText itemId={item.id} field={`_kiq.${ti}.${ki}.metrics`} label={L.metrics} text={k.metrics} comments={of(`_kiq.${ti}.${ki}.metrics`)} numberOf={numberOf} canComment={canAct} />
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          <div className="client-source">
            <button className="link-btn" aria-expanded={showText} onClick={() => setShowText((o) => !o)}>
              {showText ? "Hide" : "Show"} the text of the saved page
            </button>
            {item.hasSnapshot && <SnapshotActions itemId={item.id} code={item.code} />}
          </div>
          {showText &&
            (detail.data ? (
              <CommentableText itemId={item.id} field={PAGE_TEXT_FIELD} label="Text of the saved page" text={detail.data.bodyText ?? ""} comments={of(PAGE_TEXT_FIELD)} numberOf={numberOf} canComment={canAct} placeholder="No text was captured." />
            ) : (
              <div className="skeleton" style={{ height: 80 }} />
            ))}
        </div>
        <CommentsMargin itemId={item.id} comments={all} labelOf={labelOf} numberOf={numberOf} canResolve={false} title="Your comments" />
      </div>
    </section>
  );
}
