import { useMemo, useState } from "react";
import type { useLogWatch } from "../hooks/useLogWatch";

/** Group a raw channel token into one of our filter buckets. */
function channelGroup(channel: string | null): string {
  const c = (channel ?? "").toLowerCase();
  if (c.includes("global") || c.includes("hall")) return "global";
  if (c.includes("team")) return "team";
  if (c.includes("society") || c.includes("soc")) return "society";
  if (c.includes("trade")) return "trade";
  if (c.includes("system")) return "system";
  if (c.includes("local")) return "local";
  return "other";
}

/** Colour class keyed by channel group. */
function chanClass(group: string): string {
  return `chan--${group}`;
}

/** Just the HH:MM:SS out of a "YYYY-MM-DD HH:MM:SS" stamp. */
function clock(at: string): string {
  const m = at.match(/\d{2}:\d{2}:\d{2}/);
  return m ? m[0] : at;
}

const GROUPS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "local", label: "Local" },
  { key: "global", label: "Globals" },
  { key: "team", label: "Team" },
  { key: "society", label: "Society" },
  { key: "trade", label: "Trade" },
  { key: "system", label: "System" },
  { key: "other", label: "Other" },
];

export function Feed({ watch }: { watch: ReturnType<typeof useLogWatch> }) {
  const { items, status } = watch;
  const [filter, setFilter] = useState("all");

  // Tag every item with its group once, then derive counts + the filtered view.
  const tagged = useMemo(
    () => items.map((it) => ({ it, group: channelGroup(it.channel) })),
    [items],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const { group } of tagged) c[group] = (c[group] ?? 0) + 1;
    return c;
  }, [tagged, items.length]);
  const shown = useMemo(
    () => (filter === "all" ? tagged : tagged.filter((t) => t.group === filter)),
    [tagged, filter],
  );

  return (
    <section className="feed">
      <div className="feed__filters">
        {GROUPS.map((g) => {
          const n = counts[g.key] ?? 0;
          const disabled = g.key !== "all" && n === 0;
          return (
            <button
              key={g.key}
              className={`filt ${filter === g.key ? "filt--active" : ""}`}
              onClick={() => setFilter(g.key)}
              disabled={disabled}
            >
              {g.key !== "all" && <span className={`filt__dot ${chanClass(g.key)}`} />}
              {g.label}
              <span className="filt__count">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="feed__list">
        {shown.length === 0 ? (
          <div className="feed__empty">
            <p className="feed__empty-hint">
              {items.length === 0
                ? status.watching
                  ? "Watching — new lines appear here as they happen."
                  : "No chat.log found. Set its location in Config."
                : "No messages on this channel yet."}
            </p>
          </div>
        ) : (
          shown.map(({ it, group }) => (
            <div key={it.id} className="row">
              <span className="row__time">{clock(it.at)}</span>
              <span className={`row__chan ${chanClass(group)}`}>{it.channel ?? "—"}</span>
              <span className="row__body">
                {it.speaker && <span className="row__speaker">{it.speaker}</span>}
                <span className="row__text">{it.text || it.raw}</span>
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
