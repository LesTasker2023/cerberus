import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Mirror of the Rust `LogLine`. */
export interface LogLine {
  at: string;
  channel: string | null;
  speaker: string | null;
  text: string;
  raw: string;
}

/** Mirror of the Rust `WatchStatus`. */
export interface WatchStatus {
  watching: boolean;
  path: string | null;
}

/** One row in the live feed. */
export interface FeedItem extends LogLine {
  id: number;
}

const CAP = 1000;

/**
 * Live chat.log feed. Subscribes to the `log:line` stream and tracks watch
 * status. Newest lines are prepended; the buffer is capped. If a log resolves,
 * watching starts automatically — there are no manual controls.
 */
export function useLogWatch() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [status, setStatus] = useState<WatchStatus>({ watching: false, path: null });
  const idRef = useRef(0);

  useEffect(() => {
    // Hydrate from the live state — a `watch:status` event may have fired
    // before this mounted, which would otherwise leave us stuck on OFFLINE.
    invoke<WatchStatus>("watch_status")
      .then(setStatus)
      .catch(() => {});
    const unLine = listen<LogLine>("log:line", (e) => {
      setItems((prev) => {
        const next = [{ ...e.payload, id: idRef.current++ }, ...prev];
        return next.length > CAP ? next.slice(0, CAP) : next;
      });
    });
    const unStatus = listen<WatchStatus>("watch:status", (e) => setStatus(e.payload));
    return () => {
      unLine.then((off) => off());
      unStatus.then((off) => off());
    };
  }, []);

  const start = useCallback(async (path?: string) => {
    const next = await invoke<WatchStatus>("start_watch", { path: path ?? null });
    setStatus(next);
  }, []);

  return { items, status, start };
}
