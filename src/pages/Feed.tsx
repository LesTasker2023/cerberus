import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { useLogWatch, FeedItem, WatchStatus } from "../hooks/useLogWatch";
import type { useFeedIntel, Target, WarpMsg, ShipMsg } from "../hooks/useFeedIntel";
import { channelBucket, clock, decode, resourceKind, type WarpKind } from "../lib/feed";
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
    const isItem = /[a-z]{2,}/i.test(inner) && !/^\s*space\s*,/i.test(inner) && !/^[\d\s,.-]+$/.test(inner);
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

type Tab = "targets" | "warps" | "ships" | "trade" | "globals" | "raw";

const TABS: { key: Tab; label: string }[] = [
  { key: "targets", label: "Targets" },
  { key: "warps", label: "Warps" },
  { key: "ships", label: "Ships" },
  { key: "trade", label: "Trade" },
  { key: "globals", label: "Globals" },
  { key: "raw", label: "Raw" },
];

/** Compact "time since" (refreshed by the whole-feed ticker). */
function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export function Feed({
  watch,
  intel,
}: {
  watch: ReturnType<typeof useLogWatch>;
  intel: ReturnType<typeof useFeedIntel>;
}) {
  const { items, status } = watch;
  const [tab, setTab] = useState<Tab>("targets");
  const [q, setQ] = useState("");

  // Re-render every 5s so "ago" / ACTIVE stay fresh between globals.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const counts: Record<Tab, number> = {
    targets: intel.targets.length,
    warps: intel.warps.length,
    ships: intel.ships.length,
    trade: 0,
    globals: 0,
    raw: items.length,
  };

  return (
    <section className="feed">
      <div className="feedtabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`feedtab ${tab === t.key ? "feedtab--on" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {counts[t.key] > 0 && <span className="feedtab__n">{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      {tab === "targets" && <Targets targets={intel.targets} watching={status.watching} />}
      {tab === "warps" && <Warps warps={intel.warps} />}
      {tab === "ships" && <Ships ships={intel.ships} />}
      {tab === "trade" && (
        <Channel items={items} bucket="trade" q={q} setQ={setQ} empty="No trade chatter yet." />
      )}
      {tab === "globals" && (
        <Channel items={items} bucket="global" q={q} setQ={setQ} empty="No globals yet." />
      )}
      {tab === "raw" && <Raw items={items} status={status} q={q} setQ={setQ} />}
    </section>
  );
}

/* ── Targets board (the edge) ── */

const THRESH: { label: string; min: number }[] = [
  { label: "All", min: 0 },
  { label: "100+", min: 100 },
  { label: "250+", min: 250 },
];

function Targets({ targets, watching }: { targets: Target[]; watching: boolean }) {
  const [min, setMin] = useState(0);
  const shown = min ? targets.filter((t) => t.lastValue >= min) : targets;

  if (targets.length === 0) {
    return (
      <Empty
        hint={
          watching
            ? "Watching for space miners — as anyone globals an asteroid or space ore, they land here as a live target."
            : "Not watching chat.log. Start the tail in Config."
        }
      />
    );
  }

  return (
    <>
      <div className="tgtbar">
        <span className="tgtbar__lbl">Active space miners</span>
        <span className="tgtbar__spacer" />
        {THRESH.map((t) => (
          <button
            key={t.min}
            className={`tchip ${min === t.min ? "tchip--on" : ""}`}
            onClick={() => setMin(t.min)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="feed__list">
        {shown.map((t) => (
          <TargetRow key={t.player} t={t} />
        ))}
      </div>
    </>
  );
}

function TargetRow({ t }: { t: Target }) {
  const active = t.recent.length >= 2 && Date.now() - t.lastSeen < 120_000;
  const kind = resourceKind(t.lastResource);
  return (
    <div className={`tgt ${active ? "tgt--active" : ""}`}>
      <span className="tgt__dot" />
      <div className="tgt__main">
        <div className="tgt__name">{t.player}</div>
        <div className="tgt__res">
          <span className={`tgt__kind kind--${kind}`}>{kind}</span>
          <ItemTag name={t.lastResource} /> · <b>{t.lastValue}</b> PED
        </div>
      </div>
      <div className="tgt__stat">
        {active && <span className="tgt__flag">ACTIVE</span>}
        <span className="tgt__ago">{ago(t.lastSeen)}</span>
        <span className="tgt__tot">
          ×{t.count} · {t.total.toLocaleString()} PED
        </span>
      </div>
    </div>
  );
}

/* ── Warps ── */

const KINDS: WarpKind[] = ["pirate", "request", "offer", "info"];

function Warps({ warps }: { warps: WarpMsg[] }) {
  const [only, setOnly] = useState<Set<WarpKind>>(new Set());
  const shown = only.size ? warps.filter((w) => only.has(w.kind)) : warps;
  const toggle = (k: WarpKind) =>
    setOnly((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  if (warps.length === 0) return <Empty hint="No space-travel chatter yet." />;
  return (
    <>
      <div className="warpbar">
        {KINDS.map((k) => (
          <button
            key={k}
            className={`wchip wchip--${k} ${only.has(k) ? "wchip--on" : ""}`}
            onClick={() => toggle(k)}
          >
            {k}
          </button>
        ))}
      </div>
      <div className="feed__list">
        {shown.map((w) => (
          <div key={w.id} className="row">
            <span className="row__time">{clock(w.at)}</span>
            <span className={`wtag wtag--${w.kind}`}>{w.kind}</span>
            <span className="row__body">
              {w.speaker && <span className="row__speaker">{decode(w.speaker)}</span>}
              <span className="row__text">{linkify(decode(w.text))}</span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ── Ships ── */

function Ships({ ships }: { ships: ShipMsg[] }) {
  if (ships.length === 0)
    return <Empty hint="No ship movements yet — repair / venture / society ops land here." />;
  return (
    <div className="feed__list">
      {ships.map((s) => (
        <div key={s.id} className="row row--min">
          <span className="row__time">{clock(s.at)}</span>
          <span className="row__body">
            {s.speaker && <span className="row__speaker">{decode(s.speaker)}</span>}
            <span className="row__text">{linkify(decode(s.text))}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Channel-filtered views (trade / globals) + raw ── */

function Channel({
  items,
  bucket,
  q,
  setQ,
  empty,
}: {
  items: FeedItem[];
  bucket: string;
  q: string;
  setQ: (s: string) => void;
  empty: string;
}) {
  const rows = useMemo(() => {
    const needle = q.toLowerCase();
    return items.filter(
      (it) =>
        channelBucket(it.channel) === bucket &&
        (!needle || `${it.text} ${it.speaker ?? ""}`.toLowerCase().includes(needle)),
    );
  }, [items, bucket, q]);
  return (
    <>
      <Search q={q} setQ={setQ} placeholder="Search…" />
      <div className="feed__list">
        {rows.length === 0 ? <Empty hint={empty} /> : rows.map((it) => <RawRow key={it.id} it={it} />)}
      </div>
    </>
  );
}

function Raw({
  items,
  status,
  q,
  setQ,
}: {
  items: FeedItem[];
  status: WatchStatus;
  q: string;
  setQ: (s: string) => void;
}) {
  const rows = useMemo(() => {
    const needle = q.toLowerCase();
    return needle
      ? items.filter((it) =>
          `${it.text} ${it.speaker ?? ""} ${it.channel ?? ""}`.toLowerCase().includes(needle),
        )
      : items;
  }, [items, q]);
  return (
    <>
      <Search q={q} setQ={setQ} placeholder="Search all channels…" />
      <div className="feed__list">
        {items.length === 0 ? (
          <Empty
            hint={
              status.watching
                ? "Watching — new lines appear here as they happen."
                : "No chat.log found. Set its location in Config."
            }
          />
        ) : (
          rows.map((it) => <RawRow key={it.id} it={it} />)
        )}
      </div>
    </>
  );
}

function RawRow({ it }: { it: FeedItem }) {
  const b = channelBucket(it.channel);
  return (
    <div className="row">
      <span className="row__time">{clock(it.at)}</span>
      <span className={`row__chan chan--${b}`}>{it.channel ?? "—"}</span>
      <span className="row__body">
        {it.speaker && <span className="row__speaker">{decode(it.speaker)}</span>}
        <span className="row__text">{linkify(decode(it.text || it.raw))}</span>
      </span>
    </div>
  );
}

function Search({ q, setQ, placeholder }: { q: string; setQ: (s: string) => void; placeholder: string }) {
  return (
    <div className="feed__search">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      {q && (
        <button className="feed__searchclr" onClick={() => setQ("")} aria-label="Clear">
          ✕
        </button>
      )}
    </div>
  );
}

function Empty({ hint }: { hint: string }) {
  return (
    <div className="feed__empty">
      <p className="feed__empty-hint">{hint}</p>
    </div>
  );
}
