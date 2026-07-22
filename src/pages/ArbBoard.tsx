import { useEffect, useMemo, useState } from "react";
import { fetchAuctions, type Auction } from "../lib/auctions";
import { nexusItem } from "../lib/nexus";
import { useTradeOrders, type TradeOrder } from "../hooks/useTradeOrders";

const pct = (n: number) => `${n.toFixed(0)}%`;
const ped = (n: number) => n.toFixed(2);
const norm = (s: string) => s.toLowerCase().trim();

interface Acq {
  src: "Auction" | "Trade";
  planet: string | null;
  markup: number; // acquisition markup %
  detail: string; // price / who
}
interface Opp {
  name: string;
  tt: number | null;
  acq: Acq;
  exitMarkup: number;
  exitSrc: string;
  edgePct: number;
  edgePed: number | null;
}

/** Arb Board — combines auctions, the trade-chat order book, and Nexus markup
 *  into one ranked list of buy-low / sell-high opportunities (interplanetary). */
export function ArbBoard() {
  const orders = useTradeOrders();
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [nx, setNx] = useState<Record<string, { tt: number | null; markup: number | null }>>({});
  const [loading, setLoading] = useState(false);

  const loadAuctions = () => {
    setLoading(true);
    fetchAuctions()
      .then(setAuctions)
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(loadAuctions, []);

  // Nexus TT + markup for every item we see (auctions + orders).
  useEffect(() => {
    let live = true;
    const names = new Set<string>();
    auctions.forEach((a) => names.add(a.name));
    orders.forEach((o) => names.add(o.name));
    for (const name of names) {
      if (norm(name) in nx) continue;
      nexusItem(name)
        .then((m) => live && setNx((p) => ({ ...p, [norm(name)]: { tt: m.tt, markup: m.markup } })))
        .catch(() => live && setNx((p) => ({ ...p, [norm(name)]: { tt: null, markup: null } })));
    }
    return () => {
      live = false;
    };
  }, [auctions, orders, nx]);

  const opps = useMemo(() => {
    const wtb = new Map<string, TradeOrder[]>();
    const wts: TradeOrder[] = [];
    for (const o of orders) {
      if (o.markup == null) continue;
      if (o.side === "buy") {
        const k = norm(o.name);
        (wtb.get(k) ?? wtb.set(k, []).get(k)!).push(o);
      } else {
        wts.push(o);
      }
    }

    const bestExit = (name: string): { markup: number; src: string } | null => {
      const k = norm(name);
      const nexusMk = nx[k]?.markup ?? null;
      const buys = wtb.get(k) ?? [];
      let best: { markup: number; src: string } | null =
        nexusMk != null && nexusMk > 0 ? { markup: nexusMk, src: "Nexus" } : null;
      for (const b of buys) {
        if (b.markup != null && (!best || b.markup > best.markup)) {
          best = { markup: b.markup, src: `WTB ${b.author}${b.planet ? ` · ${b.planet}` : ""}` };
        }
      }
      return best;
    };

    const out: Opp[] = [];

    // Acquisitions from auctions (markup = price ÷ TT).
    for (const a of auctions) {
      if (a.value_ped <= 0) continue;
      const price = a.current_bid_ped > 0 ? a.current_bid_ped : a.start_bid_ped;
      const acqMarkup = (price / a.value_ped) * 100;
      const exit = bestExit(a.name);
      if (!exit || exit.markup <= acqMarkup) continue;
      const edgePct = exit.markup - acqMarkup;
      out.push({
        name: a.name,
        tt: a.value_ped,
        acq: { src: "Auction", planet: a.planet, markup: acqMarkup, detail: `${ped(price)} PED` },
        exitMarkup: exit.markup,
        exitSrc: exit.src,
        edgePct,
        edgePed: (a.value_ped * edgePct) / 100,
      });
    }

    // Acquisitions from WTS orders.
    for (const o of wts) {
      if (o.markup == null) continue;
      const exit = bestExit(o.name);
      if (!exit || exit.markup <= o.markup) continue;
      const tt = nx[norm(o.name)]?.tt ?? null;
      const edgePct = exit.markup - o.markup;
      out.push({
        name: o.name,
        tt,
        acq: {
          src: "Trade",
          planet: o.planet,
          markup: o.markup,
          detail: o.author || "chat",
        },
        exitMarkup: exit.markup,
        exitSrc: exit.src,
        edgePct,
        edgePed: tt != null ? (tt * edgePct) / 100 : null,
      });
    }

    out.sort((x, y) => (y.edgePed ?? 0) - (x.edgePed ?? 0) || y.edgePct - x.edgePct);
    return out;
  }, [auctions, orders, nx]);

  return (
    <div className="arb">
      <div className="arb__bar">
        <button className="btn btn--accent" onClick={loadAuctions} disabled={loading}>
          {loading ? "…" : "Refresh auctions"}
        </button>
        <span className="arb__stat">{opps.length} opportunities</span>
        <span className="arb__stat">{orders.length} live orders</span>
      </div>

      <div className="arb__grid">
        <section className="arb__opps">
          <h2 className="arb__h">Opportunities</h2>
          {opps.length === 0 ? (
            <p className="arb__empty">
              No arbs yet — needs auctions/trade-chat priced below Nexus market or a buy order.
            </p>
          ) : (
            <table className="arb__table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Buy</th>
                  <th>Sell</th>
                  <th className="num">Edge%</th>
                  <th className="num">Edge PED</th>
                </tr>
              </thead>
              <tbody>
                {opps.map((o, i) => (
                  <tr key={`${o.name}-${i}`}>
                    <td>{o.name}</td>
                    <td className="arb__buy">
                      {o.acq.src} · {pct(o.acq.markup)}
                      {o.acq.planet ? ` · ${o.acq.planet}` : ""}
                      <span className="arb__detail"> ({o.acq.detail})</span>
                    </td>
                    <td className="arb__sell">
                      {o.exitSrc} · {pct(o.exitMarkup)}
                    </td>
                    <td className="num arb__up">+{o.edgePct.toFixed(0)}</td>
                    <td className="num arb__up">{o.edgePed != null ? `+${ped(o.edgePed)}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="arb__orders">
          <h2 className="arb__h">Live trade orders</h2>
          {orders.length === 0 ? (
            <p className="arb__empty">Listening to trade chat… parsed orders appear here.</p>
          ) : (
            <ul className="arb__feed">
              {orders.slice(0, 60).map((o) => (
                <li key={o.id} className="arborder">
                  <span className={`arborder__side arborder__side--${o.side}`}>
                    {o.side === "buy" ? "WTB" : "WTS"}
                  </span>
                  <span className={`arborder__name ${o.matched ? "" : "arborder__name--raw"}`}>
                    {o.name}
                  </span>
                  <span className="arborder__mk">{o.markup != null ? pct(o.markup) : "—"}</span>
                  <span className="arborder__planet">{o.planet ?? "?"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
