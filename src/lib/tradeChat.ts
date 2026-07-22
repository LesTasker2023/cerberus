// Best-effort parser for EntropiaCentral trade-chat messages. Trade chat is free
// text ("WTB Shrapnel 105%", "wts [ArMatrix LR-45 (L)] 128%"), so this extracts
// what it can: side (buy/sell), item text, markup %, and the planet from the
// channel. Item text is snapped to the catalogue later (see tradeMatch).

export type Side = "buy" | "sell";

export interface ParsedOrder {
  side: Side;
  itemRaw: string;
  markup: number | null; // percent, e.g. 105
  planet: string | null;
}

// Trade channels are per-planet; map a channel name to its planet by keyword.
const CHANNELS: [string, string][] = [
  ["caly", "Calypso"],
  ["ark", "Arkadia"],
  ["cyrene", "Cyrene"],
  ["nextisland", "Next Island"],
  ["next", "Next Island"],
  ["monria", "Monria"],
  ["rock", "Rocktropia"],
  ["toulan", "Toulan"],
  ["cyclops", "Hell"],
  ["hell", "Hell"],
  ["ancient", "Ancient Greece"],
  ["greece", "Ancient Greece"],
  ["aris", "ARIS"],
];

export function planetOfChannel(channel: string): string | null {
  const c = channel.toLowerCase().replace(/[^a-z]/g, "");
  for (const [k, p] of CHANNELS) if (c.includes(k)) return p;
  return null;
}

function sideOf(text: string): Side | null {
  if (/\b(wts|selling|s>|for\s*sale|\bfs\b|\bsell\b)/i.test(text)) return "sell";
  if (/\b(wtb|buying|b>|\biso\b|\blf\b|looking\s*for|\bbuy\b)/i.test(text)) return "buy";
  return null;
}

/** Pull the item text: a bracketed [link] if present, else the leftover words
 *  after stripping intent tokens, numbers, %, ped and punctuation. */
function itemOf(content: string): string | null {
  const br = content.match(/\[([^\]]{2,})\]/);
  if (br) return br[1].trim();
  const s = content
    .replace(
      /\b(wtb|wts|buying|selling|sell|buy|iso|lf|looking\s*for|for\s*sale|fs|b>|s>|pm|pmme|offer|ea|each|stack|stackable|ped)\b/gi,
      " ",
    )
    .replace(/\d+(\.\d+)?\s*%/g, " ")
    .replace(/[^\w\s()+\-/.']/g, " ")
    .replace(/\d+(\.\d+)?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.length >= 3 ? s : null;
}

/** Parse one trade message into (usually) a single order, or [] if unparseable. */
export function parseTradeMessage(content: string, channel: string): ParsedOrder[] {
  const side = sideOf(content);
  if (!side) return [];
  const itemRaw = itemOf(content);
  if (!itemRaw) return [];
  const mk = content.match(/(\d{2,6}(?:\.\d+)?)\s*%/);
  return [
    {
      side,
      itemRaw,
      markup: mk ? parseFloat(mk[1]) : null,
      planet: planetOfChannel(channel),
    },
  ];
}
