// Parse OCR text from the in-game Private Trade window into two sides.
//
// Layout (LIST tab): a trader name, then item rows "<name>  <value> PED", then a
// "Total value: <n> PED". The top block is their offer, the bottom is yours.
// Chrome lines (title, tabs, buttons, the empty-drop hint) are skipped.

export interface TradeItem {
  name: string;
  value: number;
  /** Catalogue $Url once the name is snapped to a known item (see tradeMatch). */
  url?: string | null;
  /** True when the OCR name was matched to a catalogue item. */
  matched?: boolean;
}

export interface TradeSide {
  name: string | null;
  items: TradeItem[];
  total: number | null;
}

export interface TradeParse {
  theirs: TradeSide;
  mine: TradeSide;
}

const TOTAL = /total\s*value[:\s]*([\d.,]+)\s*ped/i;
// Any "<name> <value-token> PED" — the value token may be an OCR-garbled number
// (e.g. "om" for 0.00), cleaned by num().
const ITEM = /^(.+)\s+(\S+)\s+ped\b/i;
// Window chrome to skip: title (+ trailing ×), the ICON/LIST tabs, the empty-drop
// hint, the button row, and the capture frame's own label. Reconstructed rows can
// carry several of these tokens together, so match token runs.
const NOISE =
  /^(trade\s*capture|private\s*trade\b.*|(icon|list)(\s+(icon|list))*|drop your offers here|(confirm|clear|cancel)(\s+(confirm|clear|cancel))*|[x×|·.\-\s]*)$/i;

// Parse a value token, fixing common OCR letter→digit slips (o→0, l/i→1) so a
// misread like "om" (0.00) still yields a number.
function num(s: string): number {
  const cleaned = s.replace(/[oO]/g, "0").replace(/[lLiI]/g, "1").replace(/[^\d.]/g, "");
  const v = parseFloat(cleaned);
  return Number.isFinite(v) ? v : 0;
}

export function parseTradeOcr(text: string): TradeParse {
  const sides: TradeSide[] = [
    { name: null, items: [], total: null },
    { name: null, items: [], total: null },
  ];
  let s = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    // A "Total value" line closes the current side.
    const tot = line.match(TOTAL);
    if (tot) {
      if (s < 2) sides[s].total = num(tot[1]);
      s = Math.min(s + 1, 1);
      continue;
    }

    if (NOISE.test(line)) continue;

    // "<item>  <value> PED"
    const it = line.match(ITEM);
    if (it) {
      sides[s].items.push({ name: it[1].trim(), value: num(it[2]) });
      continue;
    }

    // Otherwise it's the trader name heading this side.
    if (!sides[s].name) sides[s].name = line;
  }

  return { theirs: sides[0], mine: sides[1] };
}
