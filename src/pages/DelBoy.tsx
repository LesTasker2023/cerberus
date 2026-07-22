import { useEffect, useMemo, useState } from "react";
import { fetchAuctions, type Auction } from "../lib/auctions";
import { nexusItem } from "../lib/nexus";

const ped = (n: number) => n.toFixed(2);

// The API's endTime is MindArk (UTC) server time. Parse as UTC and always format
// in UTC so it reads as MA time regardless of the viewer's zone.
const endMsOf = (endTime: string) => new Date(endTime.replace(" ", "T") + "Z").getTime();
const MA_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const fmtEnd = (endTime: string) => MA_FMT.format(new Date(endMsOf(endTime)));

type SortKey = "margin" | "ending" | "markup";

/** DelBoy — auction bargain hunter. Pulls the last-calls feed, matches each item
 *  to its Nexus markup, and flags where the current price sits below market. */
export function DelBoy() {
  const [rows, setRows] = useState<Auction[]>([]);
  const [markups, setMarkups] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [planet, setPlanet] = useState<string>("all");
  const [dealsOnly, setDealsOnly] = useState(true);
  const [minMargin, setMinMargin] = useState(1);
  const [auto, setAuto] = useState(false);
  const [sort, setSort] = useState<SortKey>("margin");
  const [now, setNow] = useState(Date.now());

  const load = () => {
    setLoading(true);
    setErr(null);
    fetchAuctions()
      .then((a) => {
        setRows(a);
        setNow(Date.now());
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  // Tick for the countdowns.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // Auto-refresh the feed (the endpoint is external, so keep it gentle).
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(load, 150000);
    return () => clearInterval(id);
  }, [auto]);

  // Fetch markup for each distinct item (cached in lib/nexus).
  useEffect(() => {
    let live = true;
    for (const r of rows) {
      if (r.name in markups) continue;
      nexusItem(r.name)
        .then((m) => live && setMarkups((p) => ({ ...p, [r.name]: m.found ? m.markup : null })))
        .catch(() => live && setMarkups((p) => ({ ...p, [r.name]: null })));
    }
    return () => {
      live = false;
    };
  }, [rows, markups]);

  const planets = useMemo(
    () => Array.from(new Set(rows.map((r) => r.planet))).sort(),
    [rows],
  );

  const enriched = useMemo(() => {
    const list = rows.map((a) => {
      const price = a.current_bid_ped > 0 ? a.current_bid_ped : a.start_bid_ped;
      const marketMu = markups[a.name] ?? null; // Nexus market markup %
      // The auction's own price expressed as a markup over TT.
      const auctionMu = a.value_ped > 0 ? (price / a.value_ped) * 100 : null;
      const market = marketMu != null && marketMu > 0 ? (a.value_ped * marketMu) / 100 : null;
      const margin = market != null ? market - price : null;
      const belowTT = a.value_ped > 0 && price < a.value_ped;
      // Bargain when the auction's markup is below the market markup.
      const deal = belowTT || (marketMu != null && auctionMu != null && auctionMu < marketMu);
      const ended = endMsOf(a.end_time) <= now;
      return { a, price, marketMu, auctionMu, market, margin, belowTT, deal, ended };
    });
    const filtered = list.filter((r) => {
      if (r.ended) return false;
      if (planet !== "all" && r.a.planet !== planet) return false;
      if (dealsOnly && !r.deal) return false;
      // Min PED margin cuts tiny-value noise (below-TT gems always pass).
      if (minMargin > 0 && !r.belowTT && (r.margin == null || r.margin < minMargin)) return false;
      return true;
    });
    filtered.sort((x, y) => {
      if (sort === "ending") {
        return endMsOf(x.a.end_time) - endMsOf(y.a.end_time);
      }
      if (sort === "markup") return (y.marketMu ?? -1) - (x.marketMu ?? -1);
      // margin (nulls last)
      const mx = x.margin ?? -Infinity;
      const my = y.margin ?? -Infinity;
      return my - mx;
    });
    return filtered;
  }, [rows, markups, planet, dealsOnly, minMargin, sort, now]);

  return (
    <div className="delboy">
      <div className="delboy__bar">
        <button className="btn btn--accent" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
        <select className="delboy__sel" value={planet} onChange={(e) => setPlanet(e.target.value)}>
          <option value="all">All planets</option>
          {planets.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <div className="delboy__sorts">
          {(["margin", "ending", "markup"] as SortKey[]).map((k) => (
            <button
              key={k}
              className={`delboy__sort ${sort === k ? "is-on" : ""}`}
              onClick={() => setSort(k)}
            >
              {k === "margin" ? "Best margin" : k === "ending" ? "Ending soon" : "Markup"}
            </button>
          ))}
        </div>
        <label className="delboy__deals">
          <input type="checkbox" checked={dealsOnly} onChange={(e) => setDealsOnly(e.target.checked)} />
          Deals only
        </label>
        <label className="delboy__min">
          Min +
          <input
            type="number"
            min={0}
            step={0.5}
            value={minMargin}
            onChange={(e) => setMinMargin(Number(e.target.value) || 0)}
          />
          PED
        </label>
        <label className="delboy__deals">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Auto
        </label>
        <span className="delboy__count">{enriched.length}</span>
      </div>

      <p className="delboy__legend">
        <b>Auction</b> = price ÷ TT (the markup you'd pay) · <b>Market</b> = Nexus average · a green
        Auction markup is <b>below market</b> = bargain.
      </p>

      {err && <div className="notice notice--bad">{err}</div>}

      <div className="delboy__scroll">
        <table className="delboy__table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Planet</th>
              <th className="num">Qty</th>
              <th className="num">TT</th>
              <th className="num">Price</th>
              <th className="num">Auction MU</th>
              <th className="num">Market MU</th>
              <th className="num">Margin</th>
              <th className="num">Ends</th>
            </tr>
          </thead>
          <tbody>
            {enriched.map((r, i) => (
              <tr key={`${r.a.name}-${r.a.end_time}-${i}`} className={r.deal ? "delboy__row--deal" : ""}>
                <td>
                  {r.a.name}
                  {r.belowTT && <span className="delboy__gem" title="Below TT — guaranteed profit">below TT</span>}
                </td>
                <td className="delboy__planet">{r.a.planet}</td>
                <td className="num">{r.a.quantity.toLocaleString()}</td>
                <td className="num">{ped(r.a.value_ped)}</td>
                <td className="num">{ped(r.price)}</td>
                <td
                  className={`num ${
                    r.auctionMu != null && r.marketMu != null
                      ? r.auctionMu < r.marketMu
                        ? "delboy__up"
                        : "delboy__down"
                      : ""
                  }`}
                >
                  {r.auctionMu != null ? `${r.auctionMu.toFixed(0)}%` : "—"}
                </td>
                <td className="num delboy__mu">{r.marketMu != null ? `${r.marketMu.toFixed(0)}%` : "—"}</td>
                <td className={`num ${r.margin != null ? (r.margin > 0 ? "delboy__up" : "delboy__down") : ""}`}>
                  {r.margin != null ? `${r.margin > 0 ? "+" : ""}${ped(r.margin)}` : "—"}
                </td>
                <td className="num delboy__ends">{fmtEnd(r.a.end_time)}</td>
              </tr>
            ))}
            {!loading && enriched.length === 0 && (
              <tr>
                <td colSpan={9} className="delboy__empty">
                  {rows.length ? "No bargains right now — untick Deals only to see everything." : "No auctions."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
