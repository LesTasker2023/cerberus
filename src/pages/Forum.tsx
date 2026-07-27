import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ago,
  compactNum,
  forumBoards,
  forumLatest,
  forumSearch,
  forumTopic,
  forumUser,
  newTopicUrl,
  openForum,
  stamp,
  type Board,
  type ForumPost,
  type ForumPostEvent,
  type ForumTopic,
  type ForumUser,
} from "../lib/forum";

/**
 * Forum — a reader for the Entropia Universe forum (Discourse), with the whole
 * 20-year PlanetCalypsoForum archive behind it. Master/detail: boards and topics
 * on the left, the thread on the right.
 *
 * Deliberately read-only. Posting needs an account and belongs on the real site,
 * so every reply/compose affordance opens the browser rather than faking a
 * composer we can't actually submit. Cerberus reads; the forum is where you talk.
 */
export function Forum() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [board, setBoard] = useState<number | null>(null); // null = all boards
  const [topics, setTopics] = useState<ForumTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState<ForumTopic | null>(null);
  /** New posts seen by the watcher since this list was loaded. */
  const [fresh, setFresh] = useState(0);

  useEffect(() => {
    forumBoards()
      .then(setBoards)
      .catch(() => {});
  }, []);

  const load = useCallback(
    (b: number | null) => {
      setLoading(true);
      setError(null);
      setFresh(0);
      forumLatest(b)
        .then(setTopics)
        .catch((e) => setError(String(e)))
        .finally(() => setLoading(false));
    },
    [],
  );

  useEffect(() => {
    if (!searching) load(board);
  }, [board, searching, load]);

  // Live watcher — count anything new for the board in view so the list can be
  // refreshed on demand rather than yanked out from under a read in progress.
  const boardRef = useRef(board);
  boardRef.current = board;
  const searchingRef = useRef(searching);
  searchingRef.current = searching;
  useEffect(() => {
    const un = listen<ForumPostEvent>("forum:post", (e) => {
      if (searchingRef.current) return;
      const b = boardRef.current;
      if (b === null || e.payload.category_id === b) setFresh((n) => n + 1);
    });
    return () => {
      un.then((off) => off());
    };
  }, []);

  const runSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) {
      setSearching(false);
      return;
    }
    setSearching(true);
    setLoading(true);
    setError(null);
    forumSearch(q)
      .then(setTopics)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  };

  const clearSearch = () => {
    setQuery("");
    setSearching(false);
  };

  const activeBoard = boards.find((b) => b.id === board) ?? null;

  return (
    <div className="forum">
      <div className="forum__list">
        <div className="forum__tabs">
          <button
            className={`fboard ${board === null && !searching ? "fboard--on" : ""}`}
            onClick={() => {
              clearSearch();
              setBoard(null);
            }}
          >
            All
          </button>
          {boards.map((b) => (
            <button
              key={b.id}
              className={`fboard ${board === b.id && !searching ? "fboard--on" : ""}`}
              onClick={() => {
                clearSearch();
                setBoard(b.id);
              }}
            >
              {b.name}
            </button>
          ))}
        </div>

        <form className="fsearch" onSubmit={runSearch}>
          <input
            className="fsearch__in"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search 4.6M posts — try  pirate #beyond-calypso:space"
            spellCheck={false}
          />
          {searching ? (
            <button className="fsearch__btn" type="button" onClick={clearSearch} title="Clear search">
              ✕
            </button>
          ) : (
            <button className="fsearch__btn" type="submit" title="Search the archive">
              ⌕
            </button>
          )}
        </form>

        {fresh > 0 && (
          <button className="fnew" onClick={() => load(board)}>
            <i /> {fresh} new post{fresh === 1 ? "" : "s"} — refresh
          </button>
        )}

        <div className="forum__rows">
          {loading ? (
            <div className="forum__empty">Loading…</div>
          ) : error ? (
            <div className="forum__empty forum__empty--bad">
              Couldn't reach the forum.
              <button className="flink" onClick={() => load(board)}>
                Retry
              </button>
            </div>
          ) : topics.length === 0 ? (
            <div className="forum__empty">
              {searching ? "Nothing matched that search." : "No topics on this board."}
            </div>
          ) : (
            topics.map((t) => (
              <TopicRow
                key={t.id}
                t={t}
                showBoard={board === null || searching}
                active={open?.id === t.id}
                onOpen={() => setOpen(t)}
              />
            ))
          )}
        </div>

        <div className="forum__foot">
          <button className="fcta" onClick={() => openForum(newTopicUrl(activeBoard))}>
            Start a thread on the forum ↗
          </button>
        </div>
      </div>

      <div className="forum__read">
        {open ? (
          <Thread key={open.id} topic={open} onClose={() => setOpen(null)} />
        ) : (
          <div className="forum__none">
            <span className="forum__nonet">Pick a thread</span>
            <span className="forum__nones">
              Reading is in-app. Posting opens the forum in your browser.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function TopicRow({
  t,
  showBoard,
  active,
  onOpen,
}: {
  t: ForumTopic;
  showBoard: boolean;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <div
      className={`ftopic ${active ? "ftopic--on" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="ftopic__head">
        {t.pinned && <span className="ftopic__pin" title="Pinned" aria-hidden />}
        <span className="ftopic__title">{t.title}</span>
        {t.closed && <span className="ftopic__closed" title="Closed to replies">locked</span>}
      </div>

      {t.excerpt && <span className="ftopic__ex">{t.excerpt}</span>}

      <div className="ftopic__meta">
        {showBoard && t.category && <span className="ftopic__cat">{t.category}</span>}
        <span className="ftopic__stat" title={`${t.posts_count} posts`}>
          {compactNum(t.posts_count)} replies
        </span>
        <span className="ftopic__stat" title={`${t.views} views`}>
          {compactNum(t.views)} views
        </span>
        <span className="ftopic__spacer" />
        {t.last_poster && <span className="ftopic__who">{t.last_poster}</span>}
        <span className="ftopic__ago" title={stamp(t.last_posted_at)}>
          {ago(t.last_posted_at)}
        </span>
      </div>
    </div>
  );
}

/** A thread, oldest post first. Capped server-side — twenty-year-old trade
 *  threads run to thousands of posts, so the tail links out to the browser. */
function Thread({ topic, onClose }: { topic: ForumTopic; onClose: () => void }) {
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    forumTopic(topic.id)
      .then((p) => alive && setPosts(p))
      .catch(() => alive && setError(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [topic.id]);

  useEffect(() => {
    scroll.current?.scrollTo({ top: 0 });
  }, [topic.id]);

  const truncated = posts.length > 0 && topic.posts_count > posts.length;

  return (
    <div className="fthread">
      <div className="fthread__bar">
        <button className="fthread__back" onClick={onClose} title="Back to the list" aria-label="Close thread">
          ←
        </button>
        <div className="fthread__titles">
          <span className="fthread__title">{topic.title}</span>
          <span className="fthread__sub">
            {topic.category}
            {topic.category && " · "}
            {compactNum(topic.posts_count)} posts · {compactNum(topic.views)} views
          </span>
        </div>
        <button className="fthread__ext" onClick={() => openForum(topic.url)} title="Open this thread on the forum">
          ↗
        </button>
      </div>

      <div className="fthread__scroll" ref={scroll}>
        {loading ? (
          <div className="forum__empty">Loading thread…</div>
        ) : error ? (
          <div className="forum__empty forum__empty--bad">
            Couldn't load this thread.
            <button className="flink" onClick={() => openForum(topic.url)}>
              Open it on the forum ↗
            </button>
          </div>
        ) : (
          <>
            {posts.map((p) => (
              <PostRow key={p.id} p={p} />
            ))}

            {truncated && (
              <div className="fthread__more">
                Showing the first {posts.length} of {compactNum(topic.posts_count)} posts.
                <button className="flink" onClick={() => openForum(topic.url)}>
                  Read the rest on the forum ↗
                </button>
              </div>
            )}

            <div className="fthread__reply">
              <span className="fthread__replyt">
                {topic.closed ? "This thread is closed to replies." : "Want to reply?"}
              </span>
              <button className="fcta" onClick={() => openForum(topic.url)}>
                {topic.closed ? "View on the forum ↗" : "Reply on the forum ↗"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PostRow({ p }: { p: ForumPost }) {
  return (
    <article className="fpost">
      <div className="fpost__head">
        {p.avatar ? (
          <img className="fpost__av" src={p.avatar} alt="" loading="lazy" />
        ) : (
          <span className="fpost__av fpost__av--none" />
        )}
        <ForumAuthor name={p.username} />
        <span className="fpost__num">#{p.post_number}</span>
        <span className="fpost__spacer" />
        <span className="fpost__ago" title={stamp(p.created_at)}>
          {ago(p.created_at)}
        </span>
        <button className="fpost__ext" onClick={() => openForum(p.url)} title="Open this post on the forum">
          ↗
        </button>
      </div>
      <div className="fpost__body">{p.body}</div>
    </article>
  );
}

/**
 * Author name → forum dossier popover. Distinct from `AvatarTag`, which scouts
 * an in-game avatar via EntropiaCentral; this is the forum-side record — join
 * date, post count, last seen. A 2005 join date with 4,000 posts tells you who
 * you're dealing with in a trade thread.
 */
function ForumAuthor({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [data, setData] = useState<ForumUser | null>(null);
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
    setPos({ x: Math.max(8, Math.min(r.left, window.innerWidth - 268)), y: r.bottom + 4 });
    setOpen(true);
    if (!data) {
      setLoading(true);
      try {
        setData(await forumUser(name));
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <span className="fauthor">
      <button className="fauthor__btn" onClick={onClick} title={`Forum record · ${name}`}>
        {name}
      </button>
      {open && (
        <span className="fpop" style={{ left: pos.x, top: pos.y }} onClick={(e) => e.stopPropagation()}>
          <span className="fpop__head">
            <span className="fpop__name">{name}</span>
            {data?.title && <span className="fpop__title">{data.title}</span>}
          </span>
          {loading ? (
            <span className="fpop__dim">Loading…</span>
          ) : !data?.found ? (
            <span className="fpop__dim">No forum record</span>
          ) : (
            <>
              <span className="fpop__grid">
                <PopCell k="Joined" v={data.created_at ? `${ago(data.created_at)} ago` : "—"} sub={stamp(data.created_at)} />
                <PopCell k="Last seen" v={data.last_seen_at ? `${ago(data.last_seen_at)} ago` : "—"} />
                <PopCell k="Posts" v={compactNum(data.post_count)} />
                <PopCell k="Topics" v={compactNum(data.topic_count)} />
              </span>
              <button className="fpop__link" onClick={() => openForum(data.url)}>
                Open forum profile ↗
              </button>
            </>
          )}
        </span>
      )}
    </span>
  );
}

function PopCell({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <span className="fpopcell" title={sub}>
      <span className="fpopcell__k">{k}</span>
      <span className="fpopcell__v">{v}</span>
    </span>
  );
}
