import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { useLogWatch, LogLine } from "../hooks/useLogWatch";
import { clock, decode } from "../lib/feed";
import {
  channelSlot,
  cycleChannelColor,
  loadChannelColors,
  loadChannels,
  loadTabs,
  mergeChannels,
  newTabId,
  saveChannels,
  saveTabs,
  tabMatches,
  type ChatTab,
} from "../lib/channels";
import { newTriggerId, parseTerms, type Trigger } from "../lib/triggers";
import type { ChatTriggers } from "../hooks/useChatTriggers";
import { ItemTag } from "../components/ItemTag";

/** Turn `[Bracketed Item]` tokens into clickable Nexus links; leave coord /
 *  system brackets (e.g. [Space, 1, 2, 3]) as plain text. */
function linkify(text: string): ReactNode {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const inner = m[1];
    const isItem =
      /[a-z]{2,}/i.test(inner) && !/^\s*space\s*,/i.test(inner) && !/^[\d\s,.-]+$/.test(inner);
    out.push(
      isItem ? (
        <ItemTag key={i++} name={inner}>
          [{inner}]
        </ItemTag>
      ) : (
        `[${inner}]`
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** DEV-only: result of the full chat.log history scan. Mirrors Rust `HistoryScan`. */
interface HistoryScan {
  channels: { name: string; count: number; firstAt: string; lastAt: string }[];
  lines: LogLine[];
  totalLines: number;
  chatLines: number;
  bytes: number;
  path: string;
}

/** Live chat.log feed — raw lines, newest first, plus user-defined channel tabs. */
export function Feed({
  watch,
  triggers,
}: {
  watch: ReturnType<typeof useLogWatch>;
  triggers: ChatTriggers;
}) {
  const { items, status } = watch;
  const [q, setQ] = useState("");
  const [editingTrigger, setEditingTrigger] = useState<Trigger | null>(null);

  const [channels, setChannels] = useState<string[]>(loadChannels);
  const [colors, setColors] = useState<Record<string, number>>(loadChannelColors);
  const [tabs, setTabs] = useState<ChatTab[]>(loadTabs);
  const [activeTab, setActiveTab] = useState<string | null>(null); // null = All
  const [editing, setEditing] = useState<ChatTab | null>(null);

  // Maintain the channel registry from the live tail — this is what removes the
  // need to rescan the log on every launch.
  useEffect(() => {
    setChannels((prev) => {
      const next = mergeChannels(
        prev,
        items.map((i) => i.channel),
      );
      if (next !== prev) saveChannels(next);
      return next;
    });
  }, [items]);

  const commitTabs = (next: ChatTab[]) => {
    setTabs(next);
    saveTabs(next);
  };

  /* ── DEV ONLY: seed the registry from the whole log in one pass.
     `import.meta.env.DEV` is statically false in production, so this and the
     button below are dead-code eliminated from the shipped bundle. ── */
  const [scan, setScan] = useState<HistoryScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const runScan = async () => {
    setScanning(true);
    try {
      const res = await invoke<HistoryScan>("scan_log_history", { sample: 300 });
      setScan(res);
      setChannels((prev) => {
        const next = mergeChannels(
          prev,
          res.channels.map((c) => c.name),
        );
        if (next !== prev) saveChannels(next);
        return next;
      });
    } catch {
      /* dev tool — failure is visible in the button state */
    } finally {
      setScanning(false);
    }
  };

  // Scanned lines arrive oldest-first; the live feed is newest-first.
  const source: LogLine[] = useMemo(
    () => (scan ? [...scan.lines].reverse() : items),
    [scan, items],
  );

  const tab = tabs.find((t) => t.id === activeTab) ?? null;
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return source.filter((it) => {
      if (tab && !tabMatches(tab, it.channel)) return false;
      if (!needle) return true;
      return `${it.text} ${it.speaker ?? ""} ${it.channel ?? ""}`.toLowerCase().includes(needle);
    });
  }, [source, q, tab]);

  return (
    <section className="feed">
      <div className="chantabs">
        <button
          className={`chantab ${activeTab === null ? "chantab--on" : ""}`}
          onClick={() => setActiveTab(null)}
        >
          All
        </button>
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`chantab ${activeTab === t.id ? "chantab--on" : ""}`}
            onClick={() => setActiveTab(t.id)}
            onDoubleClick={() => setEditing(t)}
            title={`${t.channels.join(", ") || "No channels"} — double-click to edit`}
          >
            {t.name}
            <span className="chantab__dots">
              {t.channels.slice(0, 5).map((c) => (
                <i key={c} className={`chantab__dot chanc-${channelSlot(c, colors)}`} />
              ))}
            </span>
            <span className="chantab__n">{t.channels.length}</span>
          </button>
        ))}
        <button
          className="chantab chantab--add"
          onClick={() => setEditing({ id: newTabId(), name: "", channels: [] })}
          title="New channel tab"
        >
          +
        </button>

        <button
          className={`chantab ${activeTab === "__alerts" ? "chantab--on" : ""}`}
          onClick={() => setActiveTab("__alerts")}
          title="Lines that fired a trigger"
        >
          Alerts
          {triggers.alerts.length > 0 && (
            <span className="chantab__n">{triggers.alerts.length}</span>
          )}
        </button>

        <span className="chantabs__spacer" />
        <div className="feed__search">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter lines…" />
          {q && (
            <button className="feed__searchclr" onClick={() => setQ("")} aria-label="Clear">
              ✕
            </button>
          )}
        </div>
      </div>

      {import.meta.env.DEV && scan && (
        <div className="devscan__bar">
          <span className="devscan__lbl">
            {scan.channels.length} channels · {scan.chatLines.toLocaleString()} chat of{" "}
            {scan.totalLines.toLocaleString()} lines · {(scan.bytes / 1048576).toFixed(1)} MB
          </span>
          <div className="devscan__chans">
            {scan.channels.map((c) => (
              <span
                key={c.name}
                className="devscan__chan"
                title={`${c.count.toLocaleString()} lines · first ${c.firstAt} · last ${c.lastAt}`}
              >
                {c.name}
                <b>{c.count.toLocaleString()}</b>
              </span>
            ))}
          </div>
          <button className="btn btn--ghost btn--sm" onClick={() => setScan(null)}>
            Back to live
          </button>
        </div>
      )}

      {activeTab === "__alerts" && (
        <div className="trigbar">
          {triggers.triggers.length === 0 ? (
            <span className="trigbar__hint">
              No triggers yet — add one to get alerted when a term appears in chat.
            </span>
          ) : (
            <div className="trigbar__list">
              {triggers.triggers.map((t) => (
                <button
                  key={t.id}
                  className={`trigchip ${t.enabled ? "trigchip--on" : ""}`}
                  onClick={() => triggers.toggleTrigger(t.id)}
                  onDoubleClick={() => setEditingTrigger(t)}
                  title={`${t.terms.join(", ")}${
                    t.channels.length ? ` · in ${t.channels.join(", ")}` : " · all channels"
                  } — click to ${t.enabled ? "disable" : "enable"}, double-click to edit`}
                >
                  {t.name}
                  <span className="trigchip__n">{t.terms.length}</span>
                </button>
              ))}
            </div>
          )}
          <span className="chantabs__spacer" />
          <button
            className="btn btn--ghost btn--sm"
            onClick={() =>
              setEditingTrigger({
                id: newTriggerId(),
                name: "",
                terms: [],
                channels: [],
                enabled: true,
              })
            }
          >
            + Trigger
          </button>
          <button
            className={`btn btn--sm ${triggers.overlayOn ? "btn--accent" : "btn--ghost"}`}
            onClick={() => triggers.showOverlay(!triggers.overlayOn)}
            title="In-game alert overlay"
          >
            {triggers.overlayOn ? "Overlay on" : "Overlay"}
          </button>
          {triggers.alerts.length > 0 && (
            <button className="btn btn--ghost btn--sm" onClick={triggers.clearAlerts}>
              Clear
            </button>
          )}
        </div>
      )}

      <div className="feed__list">
        {activeTab === "__alerts" ? (
          triggers.alerts.length === 0 ? (
            <div className="feed__empty">
              <p className="feed__empty-hint">
                Nothing has fired yet. Alerts collect here and pop up in the overlay while
                you&rsquo;re in-game.
              </p>
            </div>
          ) : (
            triggers.alerts.map((a) => (
              <div key={a.id} className="row row--alert">
                <span className="row__time">{clock(a.at)}</span>
                <span className={`row__chan chanc-${channelSlot(a.channel, colors)}`}>
                  {a.channel ?? "—"}
                </span>
                <span className="row__body">
                  <span className="row__trig">{a.triggerName}</span>
                  {a.speaker && <span className="row__speaker">{decode(a.speaker)}</span>}
                  <span className="row__text">{linkify(decode(a.text))}</span>
                </span>
              </div>
            ))
          )
        ) : rows.length === 0 ? (
          <div className="feed__empty">
            <p className="feed__empty-hint">
              {source.length === 0
                ? status.watching
                  ? "Watching — new lines appear here as they happen."
                  : "No chat.log found. Set its location in Config."
                : tab
                  ? `Nothing in ${tab.name} yet.`
                  : `Nothing matches “${q}”.`}
            </p>
          </div>
        ) : (
          rows.map((it, i) => (
            <Row key={`${it.at}-${i}`} it={it} slot={channelSlot(it.channel, colors)} />
          ))
        )}
      </div>

      {import.meta.env.DEV && (
        <button
          className="devscan__btn"
          onClick={runScan}
          disabled={scanning}
          title="DEV: scan the whole chat.log to seed the channel list"
        >
          {scanning ? "Scanning…" : "⚙ Scan history"}
        </button>
      )}

      {editing && (
        <TabEditor
          tab={editing}
          channels={channels}
          colors={colors}
          onRecolor={(name) => setColors((c) => cycleChannelColor(name, c))}
          existing={tabs}
          onSave={(t) => {
            const next = tabs.some((x) => x.id === t.id)
              ? tabs.map((x) => (x.id === t.id ? t : x))
              : [...tabs, t];
            commitTabs(next);
            setActiveTab(t.id);
            setEditing(null);
          }}
          onDelete={(id) => {
            commitTabs(tabs.filter((x) => x.id !== id));
            if (activeTab === id) setActiveTab(null);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {editingTrigger && (
        <TriggerEditor
          trigger={editingTrigger}
          channels={channels}
          existing={triggers.triggers}
          onSave={(t) => {
            triggers.upsertTrigger(t);
            setEditingTrigger(null);
          }}
          onDelete={(id) => {
            triggers.deleteTrigger(id);
            setEditingTrigger(null);
          }}
          onClose={() => setEditingTrigger(null)}
        />
      )}
    </section>
  );
}

/** Define what fires an alert: a name, the terms to watch for, and optionally
 *  which channels to restrict it to. */
function TriggerEditor({
  trigger,
  channels,
  existing,
  onSave,
  onDelete,
  onClose,
}: {
  trigger: Trigger;
  channels: string[];
  existing: Trigger[];
  onSave: (t: Trigger) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(trigger.name);
  const [terms, setTerms] = useState(trigger.terms.join(", "));
  const [picked, setPicked] = useState<string[]>(trigger.channels);
  const isNew = !existing.some((x) => x.id === trigger.id);
  const parsed = parseTerms(terms);

  const toggle = (c: string) =>
    setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));

  return (
    <div className="lcmodal" onClick={onClose} role="dialog" aria-label="Edit chat trigger">
      <div className="lcbox" onClick={(e) => e.stopPropagation()}>
        <header className="lcbox__head">
          <input
            className="lcbox__name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Trigger name (e.g. Selling ArMatrix)"
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
          />
          <button className="lcbox__x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="tabed">
          <label className="trig__lbl">
            Terms — comma or newline separated. Any one matching fires the alert.
          </label>
          <textarea
            className="trig__terms"
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            placeholder="selling armatrix, wtb ore, my avatar name"
            rows={3}
          />
          <span className="tabed__count">
            {parsed.length} term{parsed.length === 1 ? "" : "s"} · case-insensitive, matches
            anywhere in the message or speaker
          </span>

          <label className="trig__lbl">
            Channels — none selected means every channel.
          </label>
          {channels.length === 0 ? (
            <p className="tabed__empty">No channels known yet.</p>
          ) : (
            <div className="tabed__list">
              {channels.map((c) => (
                <label key={c} className="tabed__row">
                  <input type="checkbox" checked={picked.includes(c)} onChange={() => toggle(c)} />
                  <span>{c}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="tabed__actions">
          {!isNew && (
            <button className="btn btn--ghost btn--sm" onClick={() => onDelete(trigger.id)}>
              Delete
            </button>
          )}
          <span className="tabed__count">
            {picked.length === 0 ? "All channels" : `${picked.length} channels`}
          </span>
          <button
            className="btn btn--accent btn--sm"
            disabled={!name.trim() || parsed.length === 0}
            onClick={() =>
              onSave({
                id: trigger.id,
                name: name.trim(),
                terms: parsed,
                channels: picked,
                enabled: trigger.enabled,
              })
            }
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ it, slot }: { it: LogLine; slot: number }) {
  return (
    <div className="row">
      <span className="row__time">{clock(it.at)}</span>
      <span className={`row__chan chanc-${slot}`} title={it.channel ?? undefined}>
        {it.channel ?? "—"}
      </span>
      <span className="row__body">
        {it.speaker && <span className="row__speaker">{decode(it.speaker)}</span>}
        <span className="row__text">{linkify(decode(it.text || it.raw))}</span>
      </span>
    </div>
  );
}

/** Name a tab and tick the channels it should carry. Channels come from the
 *  registry (everything ever seen), so the list grows on its own. */
function TabEditor({
  tab,
  channels,
  colors,
  onRecolor,
  existing,
  onSave,
  onDelete,
  onClose,
}: {
  tab: ChatTab;
  channels: string[];
  colors: Record<string, number>;
  onRecolor: (name: string) => void;
  existing: ChatTab[];
  onSave: (t: ChatTab) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(tab.name);
  const [picked, setPicked] = useState<string[]>(tab.channels);
  const [filter, setFilter] = useState("");
  const isNew = !existing.some((x) => x.id === tab.id);

  const shown = channels.filter((c) => c.toLowerCase().includes(filter.trim().toLowerCase()));
  const toggle = (c: string) =>
    setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));

  return (
    <div className="lcmodal" onClick={onClose} role="dialog" aria-label="Edit channel tab">
      <div className="lcbox" onClick={(e) => e.stopPropagation()}>
        <header className="lcbox__head">
          <input
            className="lcbox__name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tab name (e.g. Trade)"
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
          />
          <button className="lcbox__x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="tabed">
          {channels.length === 0 ? (
            <p className="tabed__empty">
              No channels known yet. They register themselves as messages arrive — or run the
              history scan to seed them all at once.
            </p>
          ) : (
            <>
              <input
                className="tabed__filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={`Search ${channels.length} channels…`}
              />
              <div className="tabed__list">
                {shown.map((c) => (
                  <label key={c} className="tabed__row">
                    <input
                      type="checkbox"
                      checked={picked.includes(c)}
                      onChange={() => toggle(c)}
                    />
                    <button
                      type="button"
                      className={`tabed__swatch chanc-${channelSlot(c, colors)}`}
                      onClick={(e) => {
                        e.preventDefault();
                        onRecolor(c);
                      }}
                      title="Click to change this channel's colour"
                      aria-label={`Change colour for ${c}`}
                    />
                    <span className={`chanc-${channelSlot(c, colors)}`}>{c}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="tabed__actions">
          {!isNew && (
            <button className="btn btn--ghost btn--sm" onClick={() => onDelete(tab.id)}>
              Delete
            </button>
          )}
          <span className="tabed__count">{picked.length} selected</span>
          <button
            className="btn btn--accent btn--sm"
            disabled={!name.trim() || picked.length === 0}
            onClick={() => onSave({ id: tab.id, name: name.trim(), channels: picked })}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
