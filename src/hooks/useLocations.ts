import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { ClanLocation } from "../lib/locations";

/** Live clan presence: the current row per pilot from the `locations` table,
 *  seeded once then kept current over realtime (insert/update/delete). */
export function useLocations() {
  const [locs, setLocs] = useState<ClanLocation[]>([]);

  useEffect(() => {
    const sb = supabase;
    if (!sb) return;
    let active = true;

    sb.from("locations")
      .select("*")
      .then(({ data, error }) => {
        if (active && data && !error) setLocs(data as ClanLocation[]);
      });

    const upsert = (row: ClanLocation) =>
      setLocs((cur) => [row, ...cur.filter((l) => l.pilot_id !== row.pilot_id)]);

    const channel = sb
      .channel("locations")
      .on("postgres_changes", { event: "*", schema: "public", table: "locations" }, (p) => {
        if (p.eventType === "DELETE") {
          const id = (p.old as { pilot_id?: string }).pilot_id;
          setLocs((cur) => cur.filter((l) => l.pilot_id !== id));
        } else {
          upsert(p.new as ClanLocation);
        }
      })
      .subscribe();

    return () => {
      active = false;
      sb.removeChannel(channel);
    };
  }, []);

  return locs;
}
