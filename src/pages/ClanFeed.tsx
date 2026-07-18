import { useSightings } from "../hooks/useSightings";
import { supabaseReady } from "../lib/supabase";

const STATUS_LABEL: Record<string, string> = {
  off: "Not configured",
  connecting: "Connecting…",
  live: "Live",
  error: "Error",
};

/** Clan sync feed — a shared, realtime list of loots/locations/waypoints every
 *  running app posts to and reads from (Supabase). This is the sync primitive;
 *  real sources (loot from the feed, waypoints from the map) wire in next. */
export function ClanFeed({ pilot }: { pilot?: string | null }) {
  const { items, status, error, share } = useSightings();

  if (!supabaseReady) {
    return (
      <div className="clan clan--empty">
        <p>Clan sync isn’t configured.</p>
        <p className="clan__dim">
          Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to{" "}
          <code>.env</code>, then run <code>supabase/sightings.sql</code> in your project.
        </p>
      </div>
    );
  }

  const shareTest = () =>
    share({
      kind: "loot",
      name: "Test Loot",
      x: null,
      y: null,
      z: null,
      value: Math.round(Math.random() * 5000) / 100,
      pilot: pilot ?? "Pilot",
    }).catch(() => {});

  return (
    <div className="clan">
      <div className="clan__bar">
        <span className={`clan__status clan__status--${status}`}>
          <span className="clan__dot" />
          {STATUS_LABEL[status]}
        </span>
        {error && <span className="clan__err">{error}</span>}
        <button className="btn btn--accent" onClick={shareTest}>
          Share test loot
        </button>
      </div>

      <ul className="clan__list">
        {items.map((s) => (
          <li key={s.id} className="clanrow">
            <span className={`clanrow__kind clanrow__kind--${s.kind}`}>{s.kind}</span>
            <span className="clanrow__name">{s.name}</span>
            {s.value != null && <span className="clanrow__val">{s.value.toFixed(2)} PED</span>}
            {s.x != null && (
              <span className="clanrow__loc">
                [{s.x}, {s.y}, {s.z}]
              </span>
            )}
            <span className="clanrow__who">{s.pilot ?? "—"}</span>
            <span className="clanrow__time">
              {new Date(s.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </li>
        ))}
        {items.length === 0 && <li className="clan__row-empty">No sightings yet — share one.</li>}
      </ul>
    </div>
  );
}
