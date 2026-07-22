import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { parseTradeMessage, type Side } from "../lib/tradeChat";
import { snapName } from "../lib/tradeMatch";

/** A parsed, catalogue-snapped trade order from the EC trade feed. */
export interface TradeOrder {
  id: number;
  side: Side;
  name: string; // snapped catalogue name (or raw if unmatched)
  url: string | null;
  matched: boolean;
  markup: number | null;
  planet: string | null;
  author: string;
  ts: number; // received (ms)
  raw: string;
}

interface RawTrade {
  channel?: string;
  author?: string;
  content?: string;
}

/** Live buy/sell order book built from the EC trade chat. Orders older than
 *  `ttlMin` are pruned (stale asks aren't actionable). */
export function useTradeOrders(ttlMin = 45, cap = 300): TradeOrder[] {
  const [orders, setOrders] = useState<TradeOrder[]>([]);
  const [now, setNow] = useState(Date.now());
  const idRef = useRef(1);

  useEffect(() => {
    let live = true;
    const un = listen<RawTrade>("ec:trade", async (e) => {
      const r = e.payload;
      const content = (r.content ?? "").trim();
      const channel = (r.channel ?? "").replace(/^#/, "");
      for (const p of parseTradeMessage(content, channel)) {
        const snap = await snapName(p.itemRaw);
        if (!live) return;
        const o: TradeOrder = {
          id: idRef.current++,
          side: p.side,
          name: snap.name,
          url: snap.url,
          matched: snap.matched,
          markup: p.markup,
          planet: p.planet,
          author: (r.author ?? "").trim(),
          ts: Date.now(),
          raw: content,
        };
        setOrders((prev) => [o, ...prev].slice(0, cap));
      }
    });
    return () => {
      live = false;
      un.then((off) => off());
    };
  }, [cap]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => orders.filter((o) => now - o.ts < ttlMin * 60000), [orders, now, ttlMin]);
}
