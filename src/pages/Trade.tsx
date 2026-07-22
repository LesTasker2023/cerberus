import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { parseTradeOcr, type TradeItem, type TradeSide } from "../lib/tradeParse";
import { snapName } from "../lib/tradeMatch";

/** Snap every item's OCR name to the nearest catalogue item. */
async function snapSide(side: TradeSide): Promise<TradeSide> {
  const items = await Promise.all(
    side.items.map(async (it) => {
      const s = await snapName(it.name);
      return { ...it, name: s.name, url: s.url, matched: s.matched };
    }),
  );
  return { ...side, items };
}

const EMPTY_SIDE: TradeSide = { name: null, items: [], total: null };

/** A stack is identified by name + value, so the two "Shrapnel" rows stay
 *  distinct while the same row re-seen across overlapping captures dedupes. */
const key = (it: TradeItem) => `${it.name.toLowerCase()}|${it.value.toFixed(2)}`;

function mergeSide(prev: TradeSide, next: TradeSide): TradeSide {
  const seen = new Set(prev.items.map(key));
  const items = [...prev.items];
  for (const it of next.items) {
    const k = key(it);
    if (!seen.has(k)) {
      seen.add(k);
      items.push(it);
    }
  }
  return {
    name: next.name ?? prev.name,
    items,
    total: next.total ?? prev.total, // totals don't scroll — keep the last seen
  };
}

/** Trade helper — OCR-capture the in-game Private Trade window. The item list is
 *  a scroll box, so captures accumulate + dedupe; captured Σ vs the shown Total
 *  tells you when you've scrolled the whole list. Markup enrichment comes next. */
export function Trade() {
  const [boxOn, setBoxOn] = useState(false);
  const [theirs, setTheirs] = useState<TradeSide>(EMPTY_SIDE);
  const [mine, setMine] = useState<TradeSide>(EMPTY_SIDE);
  const [captures, setCaptures] = useState(0);
  const [rawText, setRawText] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    invoke<{ tradecap: boolean }>("overlay_states")
      .then((s) => setBoxOn(!!s.tradecap))
      .catch(() => {});
    const un = listen<{ tradecap: boolean }>("overlays:changed", (e) =>
      setBoxOn(!!e.payload.tradecap),
    );
    return () => {
      un.then((off) => off());
    };
  }, []);

  const toggleBox = () =>
    invoke("set_overlay", { label: "tradecap", on: !boxOn }).catch(() => {});

  const capture = async () => {
    setBusy(true);
    setErr(null);
    try {
      const text = await invoke<string>("read_trade_region");
      setRawText(text);
      const p = parseTradeOcr(text);
      const [theirsSnap, mineSnap] = await Promise.all([snapSide(p.theirs), snapSide(p.mine)]);
      setTheirs((prev) => mergeSide(prev, theirsSnap));
      setMine((prev) => mergeSide(prev, mineSnap));
      setCaptures((n) => n + 1);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setTheirs(EMPTY_SIDE);
    setMine(EMPTY_SIDE);
    setCaptures(0);
    setRawText("");
    setErr(null);
  };

  const started = captures > 0;
  const delta =
    theirs.total != null && mine.total != null ? theirs.total - mine.total : null;

  return (
    <div className="trade">
      <div className="trade__bar">
        <button className={`btn ${boxOn ? "btn--accent" : "btn--ghost"}`} onClick={toggleBox}>
          {boxOn ? "Hide capture box" : "Show capture box"}
        </button>
        <button className="btn btn--accent" onClick={capture} disabled={!boxOn || busy}>
          {busy ? "Reading…" : started ? "Capture more" : "Capture trade"}
        </button>
        {started && (
          <>
            <button className="btn btn--ghost" onClick={reset}>
              Reset
            </button>
            <span className="trade__count">{captures} captures</span>
          </>
        )}
        {rawText && (
          <button className="btn btn--ghost" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? "Hide raw" : "Raw OCR"}
          </button>
        )}
      </div>

      {err && <div className="notice notice--bad">{err}</div>}

      {!started && (
        <p className="trade__hint">
          Position the capture box over the trade window (LIST tab), then <b>Capture trade</b>. The
          list scrolls — scroll and <b>Capture more</b>; rows dedupe, and each side shows captured Σ
          vs its Total so you know when you&apos;ve got them all.
        </p>
      )}

      {started && (
        <div className="trade__grid">
          <TradeSideView title="Their offer" side={theirs} />
          <TradeSideView title="Your offer" side={mine} />
        </div>
      )}

      {delta != null && (
        <div className={`trade__delta ${delta >= 0 ? "trade__delta--pos" : "trade__delta--neg"}`}>
          {delta >= 0 ? "You gain" : "You lose"} {Math.abs(delta).toFixed(2)} PED (TT)
        </div>
      )}

      {showRaw && <pre className="trade__out">{rawText}</pre>}
    </div>
  );
}

function TradeSideView({ title, side }: { title: string; side: TradeSide }) {
  const items = [...side.items].sort((a, b) => b.value - a.value);
  const sum = items.reduce((s, it) => s + it.value, 0);
  // Each 2-decimal item can be off by up to ~0.005 vs its true value, so allow
  // the accumulated rounding rather than demanding an exact cent match.
  const tol = 0.005 * items.length + 0.01;
  const complete = side.total != null && items.length > 0 && Math.abs(sum - side.total) <= tol;

  return (
    <section className="tradeside">
      <header className="tradeside__head">
        <span className="tradeside__title">{title}</span>
        {side.name && <span className="tradeside__who">{side.name}</span>}
      </header>

      {items.length ? (
        <ul className="tradeside__list">
          {items.map((it, i) => (
            <li key={`${it.name}-${i}`} className="traderow">
              <span className={`traderow__name ${it.matched === false ? "traderow__name--raw" : ""}`}>
                {it.name}
                {it.matched === false && <span className="traderow__q" title="No catalogue match">?</span>}
              </span>
              <span className="traderow__val">{it.value.toFixed(2)} PED</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tradeside__empty">No items captured.</p>
      )}

      <footer className="tradeside__foot">
        <span>
          Σ {sum.toFixed(2)} / {side.total != null ? side.total.toFixed(2) : "—"} PED
        </span>
        {complete ? (
          <span className="tradeside__done">complete ✓</span>
        ) : (
          <span className="tradeside__more">keep scrolling</span>
        )}
      </footer>
    </section>
  );
}
