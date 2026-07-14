import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { nexusItem, type NexusItem } from "../lib/nexus";

/**
 * An item name in the feed, rendered as a clickable link. On click it fetches
 * the item's live Nexus data (TT value + market markup) and shows a popover.
 * The popover is fixed-positioned so it escapes the feed's scroll clipping.
 */
export function ItemTag({ name, children }: { name: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [data, setData] = useState<NexusItem | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    // Defer so the opening click doesn't immediately close it.
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
    setPos({ x: r.left, y: r.bottom + 4 });
    setOpen(true);
    if (!data) {
      setLoading(true);
      try {
        setData(await nexusItem(name));
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <span className="itemtag">
      <button className="itemtag__btn" onClick={onClick} title={`Nexus · ${name}`}>
        {children ?? name}
      </button>
      {open && (
        <span
          className="itempop"
          style={{ left: pos.x, top: pos.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="itempop__name">{name}</span>
          {loading ? (
            <span className="itempop__row itempop__row--dim">Looking up…</span>
          ) : !data || !data.found ? (
            <span className="itempop__row itempop__row--dim">Not on Nexus</span>
          ) : (
            <>
              {data.tt != null && (
                <span className="itempop__row">
                  TT <b>{data.tt.toFixed(2)} PED</b>
                </span>
              )}
              {data.markup != null && (
                <span className="itempop__row">
                  Markup <b>{data.markup.toFixed(0)}%</b>
                </span>
              )}
              {data.value != null && (
                <span className="itempop__row">
                  Est. value <b>{data.value.toFixed(2)} PED</b>
                </span>
              )}
            </>
          )}
        </span>
      )}
    </span>
  );
}
