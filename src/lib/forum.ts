import { invoke } from "@tauri-apps/api/core";

/** Mirror of Rust `forum::Topic`. */
export interface ForumTopic {
  id: number;
  title: string;
  url: string;
  category_id: number;
  category: string;
  posts_count: number;
  views: number;
  created_at: string;
  last_posted_at: string;
  last_poster: string;
  excerpt: string;
  tags: string[];
  closed: boolean;
  pinned: boolean;
}

/** Mirror of Rust `forum::Post`. */
export interface ForumPost {
  id: number;
  topic_id: number;
  topic_title: string;
  url: string;
  username: string;
  avatar: string;
  created_at: string;
  post_number: number;
  body: string;
}

/** Mirror of Rust `forum::ForumUser`. */
export interface ForumUser {
  found: boolean;
  username: string;
  name: string;
  avatar: string;
  url: string;
  created_at: string;
  last_seen_at: string;
  trust_level: number;
  post_count: number;
  topic_count: number;
  likes_received: number;
  title: string;
}

export interface Board {
  id: number;
  name: string;
}

/** Payload of the `forum:post` event emitted by the Rust watcher. */
export interface ForumPostEvent {
  post: ForumPost;
  category_id: number;
  category: string;
  space: boolean;
}

/** Beyond Calypso / Space — kept in sync with `forum::SPACE`. */
export const SPACE_ID = 108;

export const forumBoards = () => invoke<Board[]>("forum_boards");
export const forumLatest = (category: number | null, page = 0) =>
  invoke<ForumTopic[]>("forum_latest", { category, page });
export const forumTopic = (id: number, maxPosts = 60) =>
  invoke<ForumPost[]>("forum_topic", { id, maxPosts });
export const forumSearch = (query: string) => invoke<ForumTopic[]>("forum_search", { query });
export const forumUser = (name: string) => invoke<ForumUser>("forum_user", { name });
export const forumRecent = () => invoke<ForumPost[]>("forum_recent");

/** The forum's own base — every "open in browser" link is built from this. */
export const FORUM_BASE = "https://forum.entropiauniverse.com";

/** Hand a forum URL to the system browser. Posting happens on the real site —
 *  Cerberus is read-only, so every compose/reply affordance routes out here. */
export function openForum(url: string) {
  invoke("open_external", { url }).catch(() => {});
}

/** Discourse's new-topic composer, pre-scoped to a board when one is selected. */
export function newTopicUrl(board?: Board | null) {
  return board ? `${FORUM_BASE}/new-topic?category_id=${board.id}` : `${FORUM_BASE}/new-topic`;
}

/** Compact relative time — "4m", "3h", "2d", "5mo". Forum threads span 20 years,
 *  so this has to stay readable at both ends. */
export function ago(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(d / 365)}y`;
}

/** Absolute timestamp for tooltips — the archive's whole point is its age. */
export function stamp(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleString();
}

/** 12400 → "12.4k". Trade threads run to five figures of views. */
export function compactNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}
