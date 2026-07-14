import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { useEcIntel, Global, Trade } from "../hooks/useEcIntel";
import { resourceKind, isSpaceResource } from "../lib/feed";
import { ItemTag } from "../components/ItemTag";
import { AvatarTag } from "../components/AvatarTag";

export interface DashboardProps {
  ec: ReturnType<typeof useEcIntel>;
}

const WINDOW = 15 * 60 * 1000; // rolling stats window

type Filter = "all" | "space" | "Hunting" | "Mining";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "space", label: "Space" },
  { key: "Hunting", label: "Hunting" },
  { key: "Mining", label: "Mining" },
];

interface Hot {
  avatar: string;
  count: number;
  total: number;
  best: number;
  last: number;
  subject: string;
  space: boolean;
}

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

/**
 * The Dashboard — a live Universe Intel board powered by EntropiaCentral's
 * server-pushed feeds. Runs independently of the local chat.log: it shows the
 * whole universe's globals and trade chatter in real time, a rolling leaderboard
 * of who's hot right now, and one-click scouting into any avatar's dossier.
 */
export function Dashboard({ ec }: DashboardProps) {
  const { globals, trades } = ec;
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const recent = useMemo(() => {
    const cut = Date.now() - WINDOW;
    return globals.filter((g) => g.ts >= cut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globals, tick]);

  const stats = useMemo(() => {
    const big = recent.reduce<Global | null>(
      (m, g) => (!m || g.value > m.value ? g : m),
      null,
    );
    return {
      hits: recent.length,
      perMin: (recent.length / 15).toFixed(1),
      avatars: new Set(recent.map((g) => g.avatar)).size,
      space: recent.filter((g) => g.space).length,
      big,
    };
  }, [recent]);

  const hot = useMemo<Hot[]>(() => {
    const src = recent.filter((g) =>
      filter === "all"
        ? true
        : filter === "space"
          ? g.space
          : g.kind === filter,
    );
    const m = new Map<string, Hot>();
    for (const g of src) {
      const h = m.get(g.avatar) ?? {
        avatar: g.avatar,
        count: 0,
        total: 0,
        best: 0,
        last: 0,
        subject: "",
        space: false,
      };
      h.count += 1;
      h.total += g.value;
      h.best = Math.max(h.best, g.value);
      if (g.ts >= h.last) {
        h.last = g.ts;
        h.subject = g.subject;
      }
      h.space = h.space || g.space;
      m.set(g.avatar, h);
    }
    return [...m.values()].sort((a, b) => b.total - a.total).slice(0, 12);
  }, [recent, filter]);

  if (globals.length === 0) {
    return (
      <div className="dash intel">
        <div className="intel__connecting">
          <span className="intel__pulse" />
          <p>Connecting…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dash intel">
      <div className="intel__stats">
        <Stat
          k="Hits · 15m"
          v={String(stats.hits)}
          sub={`${stats.perMin}/min`}
        />
        <Stat
          k="Biggest"
          v={stats.big ? `${stats.big.value.toLocaleString()}` : "—"}
          sub={stats.big ? stats.big.avatar : "PED"}
          accent
        />
        <Stat k="Active" v={String(stats.avatars)} sub="avatars" />
        <Stat k="Space" v={String(stats.space)} sub="mining hits" />
      </div>

      <div className="intel__grid">
        <section className="intelcard intelcard--trade">
          <div className="intelcard__head">
            <span className="intelcard__title">Live Trade</span>
            <span className="intelcard__n">{trades.length}</span>
            <span className="intelcard__live">
              <i /> markets
            </span>
          </div>
          <div className="intelcard__list">
            {trades.length === 0 ? (
              <div className="intel__empty">Listening for trade chatter…</div>
            ) : (
              trades.map((t) => <TradeRow key={t.id} t={t} />)
            )}
          </div>
        </section>

        <div className="intelcol">
          <section className="intelcard">
            <div className="intelcard__head">
              <span className="intelcard__title">Hot Right Now</span>
              <span className="intelcard__spacer" />
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  className={`tchip ${filter === f.key ? "tchip--on" : ""}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="intelcard__list">
              {hot.length === 0 ? (
                <div className="intel__empty">
                  No {filter === "all" ? "" : filter} globals in the last 15m.
                </div>
              ) : (
                hot.map((h, i) => <HotRow key={h.avatar} h={h} rank={i + 1} />)
              )}
            </div>
          </section>

          <section className="intelcard intelcard--main">
            <div className="intelcard__head">
              <span className="intelcard__title">Live Globals</span>
              <span className="intelcard__n">{globals.length}</span>
              <span className="intelcard__live">
                <i /> universe
              </span>
            </div>
            <div className="intelcard__list">
              {globals.map((g) => (
                <GlobalRow key={g.id} g={g} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({
  k,
  v,
  sub,
  accent,
}: {
  k: string;
  v: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div className={`intelstat ${accent ? "intelstat--accent" : ""}`}>
      <span className="intelstat__v">{v}</span>
      <span className="intelstat__k">{k}</span>
      <span className="intelstat__sub">{sub}</span>
    </div>
  );
}

function GlobalRow({ g }: { g: Global }) {
  const hot = g.value >= 200;
  return (
    <div className={`grow ${g.space ? "grow--space" : ""}`}>
      <span className={`grow__val ${hot ? "grow__val--hot" : ""}`}>
        {g.value.toLocaleString()}
      </span>
      <div className="grow__main">
        <AvatarTag name={g.avatar}>
          <span className="grow__av">{g.avatar}</span>
        </AvatarTag>
        <div className="grow__sub">
          {g.kind && (
            <span
              className={`grow__kind grow__kind--${g.kind.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {g.kind}
            </span>
          )}
          {g.subject &&
            (isSpaceResource(g.subject) ? (
              <ItemTag name={g.subject} />
            ) : (
              <span className="grow__subject">{g.subject}</span>
            ))}
          {g.area && <span className="grow__area">· {g.area}</span>}
        </div>
      </div>
      <span className="grow__ago">{ago(g.ts)}</span>
    </div>
  );
}

function HotRow({ h, rank }: { h: Hot; rank: number }) {
  return (
    <div className={`hotrow ${h.space ? "hotrow--space" : ""}`}>
      <span className="hotrow__rank">{rank}</span>
      <div className="hotrow__main">
        <AvatarTag name={h.avatar}>
          <span className="hotrow__av">{h.avatar}</span>
        </AvatarTag>
        <span className="hotrow__sub">
          {h.subject && (
            <span className={`kind--${resourceKind(h.subject)}`}>
              {h.subject}
            </span>
          )}
        </span>
      </div>
      <div className="hotrow__stat">
        <span className="hotrow__tot">{h.total.toLocaleString()} PED</span>
        <span className="hotrow__count">
          ×{h.count} · best {h.best}
        </span>
      </div>
    </div>
  );
}

function linkifyTrade(text: string): ReactNode {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <ItemTag key={i++} name={m[1]}>
        [{m[1]}]
      </ItemTag>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function TradeRow({ t }: { t: Trade }) {
  return (
    <div className="trow">
      <span className="trow__chan">{t.channel}</span>
      <div className="trow__body">
        <span className="trow__author">{t.author}</span>
        <span className="trow__text">{linkifyTrade(t.content)}</span>
      </div>
      <span className="trow__ago">{ago(t.ts)}</span>
    </div>
  );
}
