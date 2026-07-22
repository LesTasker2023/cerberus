import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { useLogWatch, FeedItem } from "../hooks/useLogWatch";
import { clock, decode } from "../lib/feed";
import { ItemTag } from "../components/ItemTag";

/** Turn `[Bracketed Item]` tokens into clickable Nexus links; leave coord /
 *  system brackets (e.g. [Space, 1, 2, 3]) as plain text. */
function linkify(text: string): ReactNode {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const inner = m[1];
    const isItem =
      /[a-z]{2,}/i.test(inner) && !/^\s*space\s*,/i.test(inner) && !/^[\d\s,.-]+$/.test(inner);
    out.push(
      isItem ? (
        <ItemTag key={i++} name={inner}>
          [{inner}]
        </ItemTag>
      ) : (
        `[${inner}]`
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Live chat.log feed — every line as it lands, newest first. No channel
 *  buckets, no derived intel: just the raw tail with a text filter. */
export function Feed({ watch }: { watch: ReturnType<typeof useLogWatch> }) {
  const { items, status } = watch;
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) =>
      `${it.text} ${it.speaker ?? ""} ${it.channel ?? ""}`.toLowerCase().includes(needle),
    );
  }, [items, q]);

  return (
    <section className="feed">
      <div className="feed__search">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter lines…" />
        {q && (
          <button className="feed__searchclr" onClick={() => setQ("")} aria-label="Clear">
            ✕
          </button>
        )}
      </div>

      <div className="feed__list">
        {items.length === 0 ? (
          <div className="feed__empty">
            <p className="feed__empty-hint">
              {status.watching
                ? "Watching — new lines appear here as they happen."
                : "No chat.log found. Set its location in Config."}
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="feed__empty">
            <p className="feed__empty-hint">Nothing matches “{q}”.</p>
          </div>
        ) : (
          rows.map((it) => <Row key={it.id} it={it} />)
        )}
      </div>
    </section>
  );
}

function Row({ it }: { it: FeedItem }) {
  return (
    <div className="row">
      <span className="row__time">{clock(it.at)}</span>
      <span className="row__body">
        {it.speaker && <span className="row__speaker">{decode(it.speaker)}</span>}
        <span className="row__text">{linkify(decode(it.text || it.raw))}</span>
      </span>
    </div>
  );
}
