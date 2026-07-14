import { invoke } from "@tauri-apps/api/core";

/** Mirror of Rust `ec::EcStream`. */
export interface EcStream {
  user_name: string;
  user_login: string;
  title: string;
  viewers: number;
  started_at: string;
  thumbnail: string;
}

/** Mirror of Rust `ec::EcVideo`. */
export interface EcVideo {
  video_id: string;
  title: string;
  channel: string;
  published: string;
  thumbnail: string;
}

/** Mirror of Rust `ec::EcNews`. */
export interface EcNews {
  title: string;
  contents: string;
  date: number;
  url: string;
}

export interface EcMedia {
  streams: EcStream[];
  videos: EcVideo[];
  news: EcNews[];
}

export function ecMedia(): Promise<EcMedia> {
  return invoke<EcMedia>("ec_media");
}

/** "2h 14m" uptime from an ISO start time. */
export function uptime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

/** "3d ago" from an ISO date or a unix-seconds timestamp. */
export function whenAgo(v: string | number): string {
  const t = typeof v === "number" ? v * 1000 : Date.parse(v);
  if (Number.isNaN(t)) return "";
  const d = Math.floor((Date.now() - t) / 86_400_000);
  if (d <= 0) return "today";
  if (d === 1) return "1d ago";
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}
