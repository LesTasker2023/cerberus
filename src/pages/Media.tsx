import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { decode } from "../lib/feed";
import {
  ecMedia,
  uptime,
  whenAgo,
  type EcMedia,
  type EcStream,
  type EcVideo,
  type EcNews,
} from "../lib/ecMedia";

type Embed = { kind: "youtube"; id: string; title: string };

/**
 * Pop a Twitch channel into its own window.
 *
 * Not an in-app iframe: Twitch requires `parent=<host>` on embeds, and Tauri's
 * production custom protocol is not an origin it accepts — so an embed that
 * works in dev silently fails once packaged. A dedicated window navigates to
 * Twitch as a top-level document, where that restriction doesn't apply.
 */
/**
 * The bare player — no nav, no chat, no page chrome, just the video.
 *
 * `parent` is only enforced when the player is inside an iframe (Twitch checks
 * the ancestor origin). Loaded top-level in its own window there is no ancestor,
 * so the check doesn't apply and the packaged app is unaffected.
 */
function playerUrl(login: string) {
  return `https://player.twitch.tv/?channel=${encodeURIComponent(login)}&parent=twitch.tv`;
}

/** The full site, for when you want chat too. */
function channelUrl(login: string) {
  return `https://www.twitch.tv/${login}`;
}

/** Force the system browser — the guaranteed path if the in-app window misbehaves. */
function openInBrowser(login: string) {
  invoke("open_external", { url: channelUrl(login) }).catch(() => {});
}

/** Pop the video into a small always-on-top window — picture-in-picture over the game. */
function popStream(login: string, title: string) {
  invoke("open_stream", {
    label: `stream-${login.toLowerCase().replace(/[^a-z0-9_-]/g, "")}`,
    url: playerUrl(login),
    title: `${title} — Twitch`,
    alwaysOnTop: true,
    width: 512,
    height: 288, // 16:9
  }).catch(() => openInBrowser(login));
}

/**
 * Media — the community/recon surface. Live Twitch broadcasts (the thumbnail is
 * a near-live peek at a player's screen — coords, what they're doing), recent
 * videos, and Steam patch news. Twitch streams pop into their own window (see
 * `popStream`); YouTube videos open in an in-app embed. Polled every 60s.
 */
export function Media() {
  const [media, setMedia] = useState<EcMedia | null>(null);
  const [loading, setLoading] = useState(true);
  const [embed, setEmbed] = useState<Embed | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      ecMedia()
        .then((m) => alive && setMedia(m))
        .catch(() => {})
        .finally(() => alive && setLoading(false));
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (loading && !media) {
    return (
      <div className="media">
        <div className="media__empty">Loading live streams, videos &amp; news…</div>
      </div>
    );
  }

  const streams = media?.streams ?? [];
  const videos = media?.videos ?? [];
  const news = media?.news ?? [];

  return (
    <div className="media">
      <section className="mediasec">
        <div className="mediasec__head">
          <span className="mediasec__title">Live Now</span>
          {streams.length > 0 && (
            <span className="mediasec__live">
              <i /> {streams.length} on Twitch
            </span>
          )}
        </div>
        {streams.length === 0 ? (
          <div className="media__empty">No one's streaming Entropia right now.</div>
        ) : (
          <div className="streamgrid">
            {streams.map((s) => (
              <StreamCard key={s.user_login} s={s} onPlay={() => popStream(s.user_login, s.user_name)} />
            ))}
          </div>
        )}
      </section>

      <div className="media__cols">
        <section className="mediasec">
          <div className="mediasec__head">
            <span className="mediasec__title">Universe News</span>
          </div>
          {news.length === 0 ? (
            <div className="media__empty">No news.</div>
          ) : (
            <div className="newslist">
              {news.map((n, i) => (
                <NewsRow key={i} n={n} />
              ))}
            </div>
          )}
        </section>

        <section className="mediasec">
          <div className="mediasec__head">
            <span className="mediasec__title">Recent Videos</span>
          </div>
          {videos.length === 0 ? (
            <div className="media__empty">No videos.</div>
          ) : (
            <div className="videogrid">
              {videos.map((v) => (
                <VideoCard key={v.video_id} v={v} onPlay={() => setEmbed({ kind: "youtube", id: v.video_id, title: decode(v.title) })} />
              ))}
            </div>
          )}
        </section>
      </div>

      {embed && <EmbedModal embed={embed} onClose={() => setEmbed(null)} />}
    </div>
  );
}

function StreamCard({ s, onPlay }: { s: EcStream; onPlay: () => void }) {
  return (
    <div
      className="streamc"
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPlay();
        }
      }}
    >
      <span className="streamc__thumb">
        <img src={s.thumbnail} alt="" loading="lazy" />
        <span className="streamc__badge">
          <i /> LIVE
        </span>
        <span className="streamc__viewers">{s.viewers.toLocaleString()} watching</span>
        <span className="streamc__play" aria-hidden>
          ▶
        </span>
        <button
          className="streamc__ext"
          title="Open in your browser instead"
          aria-label={`Open ${s.user_name} in browser`}
          onClick={(e) => {
            e.stopPropagation();
            openInBrowser(s.user_login);
          }}
        >
          ↗
        </button>
      </span>
      <span className="streamc__name">{s.user_name}</span>
      <span className="streamc__title" title={s.title}>
        {s.title}
      </span>
      <span className="streamc__up">{uptime(s.started_at)}</span>
    </div>
  );
}

function VideoCard({ v, onPlay }: { v: EcVideo; onPlay: () => void }) {
  return (
    <button className="videoc" onClick={onPlay}>
      <span className="videoc__thumb">
        <img src={v.thumbnail} alt="" loading="lazy" />
        <span className="videoc__play" aria-hidden>
          ▶
        </span>
      </span>
      <span className="videoc__title" title={decode(v.title)}>
        {decode(v.title)}
      </span>
      <span className="videoc__meta">
        {decode(v.channel)} · {whenAgo(v.published)}
      </span>
    </button>
  );
}

function NewsRow({ n }: { n: EcNews }) {
  return (
    <div className="newsrow">
      <div className="newsrow__head">
        <span className="newsrow__title">{n.title}</span>
        <span className="newsrow__ago">{whenAgo(n.date)}</span>
      </div>
      <span className="newsrow__body">{n.contents}</span>
    </div>
  );
}

/** YouTube keeps the in-app embed — unlike Twitch it imposes no `parent`
 *  origin check, so it works the same packaged as it does in dev. */
function EmbedModal({ embed, onClose }: { embed: Embed; onClose: () => void }) {
  const src = `https://www.youtube-nocookie.com/embed/${embed.id}?autoplay=1`;
  return (
    <div className="embed" onClick={onClose}>
      <div className="embed__box" onClick={(e) => e.stopPropagation()}>
        <div className="embed__bar">
          <span className="embed__title">{embed.title}</span>
          <button className="embed__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="embed__frame">
          <iframe src={src} title={embed.title} allow="autoplay; fullscreen" allowFullScreen />
        </div>
      </div>
    </div>
  );
}
