import { loadSearch } from "./codex/store";

/** Snap an OCR-garbled item name to the nearest known catalogue item. */
export interface Snap {
  name: string;
  url: string | null;
  matched: boolean;
}

interface Entry {
  name: string;
  url: string;
  norm: string;
}

// Catalogue of tradeable item names (mobs excluded), lower-cased for matching.
let catalogP: Promise<Entry[]> | null = null;
function catalog(): Promise<Entry[]> {
  catalogP ??= loadSearch().then((rows) =>
    rows
      .filter((r) => r.kind !== "mobs")
      .map((r) => ({ name: r.name, url: r.url, norm: r.name.toLowerCase() })),
  );
  return catalogP;
}

/** Levenshtein edit distance with an early-out once it exceeds `max`. */
function lev(a: string, b: string, max: number): number {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}

/** Match an OCR item name to the catalogue. Returns the snapped name + $Url when
 *  a close-enough item is found, else the original name unmatched. */
export async function snapName(ocr: string): Promise<Snap> {
  const q = ocr.toLowerCase().trim();
  if (!q) return { name: ocr, url: null, matched: false };
  const cat = await catalog();

  // Allow ~1 edit per 3 chars.
  const budget = Math.max(2, Math.floor(q.length * 0.34));
  let best: Entry | null = null;
  let bestD = budget + 1;
  for (const c of cat) {
    if (Math.abs(c.norm.length - q.length) > bestD) continue;
    const d = lev(q, c.norm, bestD - 1);
    if (d < bestD) {
      bestD = d;
      best = c;
      if (d === 0) break;
    }
  }

  return best ? { name: best.name, url: best.url, matched: true } : { name: ocr, url: null, matched: false };
}
