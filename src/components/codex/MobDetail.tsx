import type { Mob } from "../../lib/codex/types";
import { DamageBars, RefLink, Section, Stat } from "./CodexBits";

const ATTRS = ["Strength", "Agility", "Intelligence", "Psyche", "Stamina"] as const;

/** Full mob page: profile, per-maturity stats, spawns and loot — all from the
 *  mob's embedded Maturities / Spawns / Loots. */
export function MobDetail({ mob, onOpen }: { mob: Mob; onOpen: (url: string) => void }) {
  const mats = mob.Maturities ?? [];
  const spawns = mob.Spawns ?? [];
  const loots = mob.Loots ?? [];
  const anyDefense = mats.some((m) => {
    const d = m.Properties.Defense;
    return d && Object.values(d).some((v) => Number(v ?? 0) > 0);
  });

  return (
    <div className="codexdetail">
      <header className="codexhead">
        <div>
          <h2 className="codexhead__name">{mob.Name}</h2>
          <div className="codexhead__sub">
            <span className="codexbadge">Mob</span>
            {mob.Type && <span>{mob.Type}</span>}
            {mob.Properties.IsSweatable && <span>Sweatable</span>}
          </div>
        </div>
      </header>

      {mob.Properties.Description && <p className="codexdesc">{mob.Properties.Description}</p>}

      <Section title="Profile">
        <div className="codexgrid">
          <Stat label="Planet">
            <RefLink r={mob.Planet} onOpen={onOpen} />
          </Stat>
          <Stat label="Species">
            <RefLink r={mob.Species} onOpen={onOpen} />
          </Stat>
          <Stat label="Evade prof.">
            <RefLink r={mob.DefensiveProfession} onOpen={onOpen} />
          </Stat>
          <Stat label="Scan prof.">
            <RefLink r={mob.ScanningProfession} onOpen={onOpen} />
          </Stat>
        </div>
      </Section>

      {mats.length > 0 && (
        <Section title="Maturities" count={mats.length}>
          <table className="codextable">
            <thead>
              <tr>
                <th>Maturity</th>
                <th>Lvl</th>
                <th>HP</th>
                <th>APM</th>
                {ATTRS.map((a) => (
                  <th key={a}>{a.slice(0, 3)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mats.map((m) => {
                const at = m.Properties.Attributes ?? {};
                return (
                  <tr key={m.Id}>
                    <td>{m.Name}</td>
                    <td>{m.Properties.Level ?? "—"}</td>
                    <td>{m.Properties.Health ?? "—"}</td>
                    <td>{m.Properties.AttacksPerMinute ?? "—"}</td>
                    {ATTRS.map((a) => (
                      <td key={a}>{at[a] ?? "—"}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {anyDefense && <DamageBars d={mats.find((m) => m.Properties.Defense)?.Properties.Defense} />}
        </Section>
      )}

      {spawns.length > 0 && (
        <Section title="Spawns" count={spawns.length}>
          <ul className="codexlist">
            {spawns.map((s) => {
              const c = s.Properties?.Coordinates;
              return (
                <li key={s.Id} className="codexlist__row">
                  <span>{s.Name}</span>
                  <span className="codexlist__meta">
                    {s.Planet?.Name}
                    {c && ` · [${c.Longitude}, ${c.Latitude}]`}
                    {s.Properties?.Density != null && ` · density ${s.Properties.Density}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {loots.length > 0 && (
        <Section title="Loot" count={loots.length}>
          <table className="codextable">
            <thead>
              <tr>
                <th>Item</th>
                <th>Maturity</th>
                <th>Freq.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loots.map((l, i) => (
                <tr key={i} className={l.IsDropping ? "" : "codextable__stale"}>
                  <td>
                    <RefLink r={l.Item} onOpen={onOpen} />
                  </td>
                  <td>{l.Maturity?.Name ?? "—"}</td>
                  <td>{l.Frequency ?? "—"}</td>
                  <td>{l.IsDropping ? "" : "old"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}
