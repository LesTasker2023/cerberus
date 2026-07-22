import { invoke } from "@tauri-apps/api/core";

/** One auction from the EU "last calls" feed (mirrors the Rust `Auction`). */
export interface Auction {
  planet: string;
  name: string;
  quantity: number;
  value_ped: number; // TT
  start_bid_ped: number;
  current_bid_ped: number;
  bid_count: number;
  end_time: string; // "YYYY-MM-DD HH:MM:SS" server time
}

export function fetchAuctions(): Promise<Auction[]> {
  return invoke<Auction[]>("auction_last_calls");
}
