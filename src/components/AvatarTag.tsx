import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ecAvatar, compact, since, type Avatar } from "../lib/ec";

/**
 * A player name, rendered as a clickable scout link. On click it pulls the
 * avatar's EntropiaCentral dossier and shows it in an in-app popover — activity,
 * wealth, whether they're a space miner, and whether they can fight back. Fixed-
 * positioned so it escapes any scroll clipping.
 */
export function AvatarTag({ name, children }: { name: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [data, setData] = useState<Avatar | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const id = window.setTimeout(() => {
      document.addEventListener("click", close);
      window.addEventListener("scroll", close, true);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Clamp the popover to the viewport so long dossiers stay on-screen.
    const x = Math.min(r.left, window.innerWidth - 288);
    setPos({ x: Math.max(8, x), y: r.bottom + 4 });
    setOpen(true);
    if (!data) {
      setLoading(true);
      try {
        setData(await ecAvatar(name));
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    }
  };

  const spaceMiner = (data?.space_mining_globals ?? 0) > 0;
  const canFight = (data?.pvp_kills ?? 0) > 0;

  return (
    <span className="avtag">
      <button className="avtag__btn" onClick={onClick} title={`Scout · ${name}`}>
        {children ?? name}
      </button>
      {open && (
        <span className="avpop" style={{ left: pos.x, top: pos.y }} onClick={(e) => e.stopPropagation()}>
          <span className="avpop__head">
            <span className="avpop__name">{data?.name ?? name}</span>
            {data?.found && data.ec_rank != null && <span className="avpop__rank">#{data.ec_rank}</span>}
          </span>

          {loading ? (
            <span className="avpop__dim">Scouting…</span>
          ) : !data || !data.found ? (
            <span className="avpop__dim">No EntropiaCentral record</span>
          ) : (
            <>
              <span className="avpop__tags">
                {spaceMiner && <span className="avpop__tag avpop__tag--space">Space miner</span>}
                {canFight ? (
                  <span className="avpop__tag avpop__tag--danger">PvP {data.pvp_kills} kills</span>
                ) : (
                  <span className="avpop__tag avpop__tag--soft">No PvP kills</span>
                )}
              </span>

              <span className="avpop__grid">
                <Cell k="Lifetime" v={`${compact(data.total_value)} PED`} />
                <Cell k="Globals" v={compact(data.total_globals)} />
                <Cell k="Biggest" v={data.largest_global != null ? `${data.largest_global.toLocaleString()}` : "—"} sub={data.largest_detail} />
                <Cell k="Last seen" v={since(data.last_global_at)} />
              </span>

              {(data.space_mining_globals ?? 0) > 0 && (
                <span className="avpop__space">
                  <b>{data.space_mining_globals}</b> space globals · {compact(data.space_mining_value)} PED
                  {data.largest_space_deposit && ` · best ${data.largest_space_deposit}`}
                </span>
              )}
            </>
          )}
        </span>
      )}
    </span>
  );
}

function Cell({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <span className="avcell">
      <span className="avcell__k">{k}</span>
      <span className="avcell__v">{v}</span>
      {sub && <span className="avcell__sub">{sub}</span>}
    </span>
  );
}
