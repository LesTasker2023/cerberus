# Knowledge Pipeline — findings & design notes

Working notes toward the "Entropia AI": a grounded question-answering layer over
the data sources Cerberus already touches. **Nothing here is built yet.** This
file exists so the research isn't re-done from scratch.

Last updated: 2026-07-26.

---

## The three sources, and what each one is for

The central design decision: **these are not interchangeable, and mixing up their
retrieval mechanisms is how the project fails.**

| Source | Shape | Mechanism | Answers |
|---|---|---|---|
| **Nexus** | Structured, exact, canonical | **Tool call** — deterministic lookup | "Warp Mine BP needs 1× Generic Transformer" |
| **Models** | Distilled mechanic, verified, in code | **Computation** | "At coloring level 12.4, use Purple, X PED/click" |
| **Forum** | Unstructured, contested, dated | **Retrieval** — search + cite | "Mid-to-high maturity, confirmed Nov 2025" |
| **EntropiaCentral** | Community-observed activity | **Tool call** | "1,278 globals, avg 137 PED" |

### Hard rules

- **Never vector-embed the Nexus stat tables.** Embedding numbers produces
  fluent, plausible, wrong figures, and a wrong decay/TT value costs real PED.
  Stats are a function call returning exact values, not a recalled fact.
- **Every answer cites, or there is no answer.** Extraction only, never unsourced
  synthesis. Forum citations must carry their date — a 2013 claim must *look*
  like a 2013 claim. If retrieval finds nothing, say so; an Entropia AI that
  invents a blueprint is worse than no AI, because people spend money on it.
- **LLM is the mouth, not the brain.** Same principle as Artemis Pro. Its job is
  routing to the right source/model and explaining the result.
- **Don't ship an API key in the Tauri binary.** It gets extracted and drained.
  Proxy through a backend, gated on the Discord auth already in `auth.rs`.
  (See also: the Supabase anon key we already ship publicly with `using(true)`
  RLS — a pattern to break, not repeat.)

### The wedge

Forum-plus-Nexus knowledge is table stakes; Entropedia and the wikis have most of
it. What nothing else can do is answer **with the user's live context** — the
chat.log tail, position, loadout, current hunt session. "Is this mob worth
hunting with the gear I've got on" is the product. Design toward it.

---

## Automatable heuristic: the stale-VU detector

**The single most useful thing found so far.** Nexus loot rows carry a `LastVU`
stamp. When one row's VU lags the rest of its own mob's table by a wide margin,
that row is the untrustworthy one — and that is exactly the case where the forum
should be consulted.

Discovered via Generic Transformer: Cosmic Horror has 30 loot rows, 29 of them
VU 17.x, and the Generic Transformer row stamped **VU 12.1**. Trusting it blindly
sends you on a hunt that a forum thread documents as already having failed.

Cheap to compute, no model needed. This is the first routing rule to build.

---

## Source coverage gaps (measured 2026-07-26)

**Nexus** (`api.entropianexus.com`)
- 829 mobs, 16,740 items, 3,993 blueprints, 2,128 missions, 124 vehicles, 336 misctools.
- **212 mobs have no loot data at all.**
- Loot freshness: bulk is VU 17.x; 1,066 rows have no VU stamp.
- **No spawn polygons for any of the 10 space mobs.** Planet only, never coordinates.
- Mission *rewards* exist only on `/missions/<id>`, NOT the list endpoint —
  answering "which missions reward skill X" costs a 2,128-request sweep.
  → **Needs a local index + scheduled refresh, same as the existing `nexus.rs`
  daily rebuild.** Any "find all X that reward/drop Y" question needs this.
- Mob `Loots` ARE on the list endpoint (one fetch covers all 829). Loot rows
  carry Item, Maturity, Frequency, LastVU, IsDropping, IsEvent.

**Forum** (Discourse, `forum.entropiauniverse.com`)
- Fully readable anonymously; 0 of 70 categories are read-restricted.
- 289,723 topics / 4,663,751 posts; `/sitemap.xml` → 28 files × 10k = full index.
- Search is keyword-only. **It cannot bridge paraphrases** — "coloring mission"
  returned pure noise while "colorer skill" found the real cluster. A local
  embedding index over the high-value slice is not optional.
- **Trading boards must be excluded from any knowledge index.** Top hits for most
  item queries are "WTS / bump / bump". Dropping Trading takes the useful slice
  from ~128k topics to **~16k (≈1 day of polite fetching)** and raises quality.
- `cooked` HTML still contains raw vBulletin BBCode from the migration —
  `[SIZE=4]`, href-less `<a>`. Already handled by `to_text` in `forum.rs`.

**EntropiaCentral** (`api.entropiacentral.com`)
- **Belongs in the pipeline as a first-class source, not just the live globals
  feed.** It covers mobs Nexus doesn't have at all.
- `/search?q=` works and is the way in. `/creatures/<slug>` returns detail;
  slugs are **per-maturity** (`atrox-young`, not `atrox` — `atrox` is a Codex entry).
- Creature records are often empty stubs (all zeros) even when the mob is real
  and actively hunted — absence of stats is NOT absence of the mob.
- Global aggregates render on the web page (`entropiacentral.com/wiki/creatures/<slug>`)
  but not in the API stub. ⚠️ The page shows a "Jun 27 – Jul 26" style date range
  next to the totals — **that label belongs to an activity chart, not the totals.
  The totals are all-time.** Verified against Atrox Young (177,749 globals).
- Requires Edge runtime on Vercel (see `reference_ec_edge_runtime` — Cloudflare
  blocks Node-serverless egress IPs).

---

## Worked example 1: Generic Transformer  (the pipeline's best proof)

**Question:** "I want to hunt and loot a Generic Transformer."

**Item** — `1000915`, Material / "Generic Component", **5 PED max TT**, weight 0.3,
tradeable, not flagged rare. **No blueprint produces it — loot only.**

**Nexus says:** exactly one source in 829 mobs — **Cosmic Horror** (Space),
frequency *Uncommon*, maturity unspecified, **stamped VU 12.1** while 29 of that
mob's other 30 rows are VU 17.x. Classic stale-VU outlier.

**Forum resolves it** — [t/287768](https://forum.entropiauniverse.com/t/287768),
Nov 2025, titled *"Do 'Generic Transformer' still drop?"* — the same question,
asked by someone who hunted cosmic horrors "for hours and hours" and got none:

| Claim | Source | Weight |
|---|---|---|
| Still drops — one landed ~25 Nov 2025 | FireFist, #6 | Firsthand, recent |
| **"Mid to high lvl space horrors usually have them"** | John_B_Knight, #11 | Firsthand, claims a stash |
| Maturity gating is a real mechanic (Atrox Alpha → Isis CB26) | TonySamTaler, #2 | Corroborating precedent |
| "Space Pirates also drop them — the mob" | FireFist, #12 | **Unverified — see below** |

**Conclusion: Cosmic Horror, Guardian maturity and above.** Nexus lists ten
maturities — Young, Old, Mature, Provider, Guardian, Dominant, Alpha, Old Alpha,
Prowler, Stalker. Codex base cost 81.25. The maturity gate is almost certainly
why the drop looks dead in stale data and why the OP's grind failed.

**Market: zero rows** across 1,384 tracked items — and that is NOT a tracking gap
("Generic Leather", "Generic Nano Adjuster" *are* tracked). The forum explains it:
players deliberately hoard them to keep warp mines away from pirates. One poster
describes someone buying up every one that drops and stockpiling for years;
another will only sell to a buyer who won't use it. FireFist, plainly:
*"as far as where they drop i think thats info we dont want pirates having."*

⚠️ **Relevant to us specifically** — the scarcity of this information is partly
deliberate and aimed at our side of the game.

**What it's for** — Warp Mine Mk. 1 (L) Blueprint (L), Tool Engineer, level 4,
SiB, learning interval from 7.5. BP itself is `IsDroppable: false`.

| Material | Qty | TT each | TT total |
|---|---|---|---|
| Generic Transformer | 1 | 5.00 | **5.00** |
| Narcanisum Ingot | 19 | 0.24 | 4.56 |
| Simple 2 Conductors | 3 | 0.65 | 1.95 |
| Belkar Ingot | 20 | 0.06 | 1.20 |
| | | | **≈12.71 PED in** |

Product: Warp Mine Mk. 1, **0.02 PED TT** — near-total TT destruction, but that's
the wrong frame for a PvP consumable. The Transformer is 39% of input value,
which is why it's the bottleneck rather than the ingots.

---

## Worked example 2: Pirate Cutlass  (the gap EC fills)

Chasing FireFist's "Space Pirates" lead. **Nexus has no record of them whatsoever**
— not in 829 mobs, 16,740 items, 124 vehicles or 336 misctools. Checked the
reverse too: no Nexus mob has a "Cutlass" species or maturity, and "Outcast" /
"Bandit" / "Brigand" turn out to be generic humanoid maturity names shared across
Fierling, Boorum, Calamusoid, Maffoid, Feffoid and a dozen more — **none of which
drop Generic Transformer.** It is not hiding under another name.

**EC has them** (all-time global aggregates):

| Creature | Globals | Total PED | Avg | Highest |
|---|---|---|---|---|
| **Pirate Cutlass Brigand** | 1,278 | 175,427 | 137.27 | **10,394** |
| Pirate Cutlass Outcast | 27 | 5,202 | 192.67 | 2,214 — HoF, team, 11 May 2025 |
| Pirate Cutlass Bandit | 8 | 1,176 | 147.00 | 290 — Big KO4EGAR XXL, 14 Feb 2025 |

EC's creature records are **empty stubs** — health 0, level 0, planet blank, type
"Unknown", no loot table (compare Atrox Young: health 990, level 17, three
planets). Not a fetch problem: nobody has ever documented this mob.

**Still open:** whether Pirate Cutlass drops Generic Transformer, and what planet
it's even on. No loot data in any source. Zero forum hits for "pirate cutlass",
"cutlass brigand", "cutlass outcast" or "cutlass bandit".

### 🎯 Opportunity

**Pirate Cutlass Brigand is an actively-hunted mob — 175k PED of recorded globals —
with zero public documentation anywhere.** Hunting it and logging loot through
Cerberus would produce data that genuinely does not exist yet, including a real
answer on the Generic Transformer question. Given the community deliberately
withholds that answer from pirates, generating it ourselves is likely the only
way we get it. Feeds directly into the existing sighting/POI logging.

---

## Worked example 3: coloring dailies

Asked "where can I do daily missions that return coloring skill?" — scanned all
2,128 Nexus missions. **Exactly 5** reward a coloring-family skill, all on
**Next Island**, all 20h cooldown, and all **kill** missions, not coloring:

| Mission | Objective | Reward |
|---|---|---|
| Daily Color Mania (Frida) | 500 Frida Papoo | 0.5 PED Coloring Methodology |
| Daily Grey Papoo | 1,000 Grey Papoo (Leonardo counts) | 0.4 PED **Coloring** |
| Daily Color Mania (Leonardo) | 500 Leonardo Papoo | 0.4 PED Coloring Methodology |
| Daily Color Mania (Salvador) | 500 Salvador Papoo | 0.3 PED Coloring Methodology |
| Daily Color Mania (Pablo) | 500 Pablo Papoo | 0.2 PED Coloring Methodology |

**1.8 PED of skill per 20h for 3,000 kills** — negligible. Nexus has no
coordinates for those NPCs. The real answer (level by *doing* coloring) is a
**model**, not a retrieval — and it already exists, see below.

---

## The `models/` layer — port from delta

`delta`'s `/colouring` route is a **worked prototype of the whole product**, built
by hand for one profession: a 2010 forum guide read, a mechanic extracted
(`maxed = recommended × 1.1 + 2.5`, credited to Dessy), verified against live
Nexus data, turned into code that computes a level-by-level leveling ladder
priced with live market markup.

It answers "how do I level coloring" far better than any retrieval could, because
the answer **isn't in any post** — it's computed.

**Port target:** `delta/src/lib/colouring.ts` + `delta/src/lib/texturing.ts` are
pure functions, no React, no Next dependency → they move into a Cerberus
`models/` layer nearly unchanged. The paints price route needs a home: either the
backend, or reimplement in `nexus.rs` beside the existing catalog fetch.

⚠️ **BLOCKED — do not port yet.** `delta/src/lib/colouring.ts` carries an
`OPEN QUESTION` block (added 2026-07-26): the "skill is per-click, not per-can"
premise behind `CANS_PER_CLICK = 10` is **not established by the source it cites**,
and two 2013 threads contradict it. If skill tracks TT burned, the ladder
optimises the wrong thing and the per-click cost is ~10× understated. Settle it
in-game first (matched runs, 10 clicks × 10 cans vs 10 clicks × 100 cans);
everything downstream inherits the assumption.

---

## Build order (proposed)

1. **Nexus mission + loot index** in `nexus.rs` — local, scheduled refresh like
   the existing daily rebuild. Makes "what drops/rewards X" instant instead of a
   2,128-request sweep. Useful in the Codex on its own, before any AI exists.
2. **Stale-VU detector** — cheap, no model, immediately improves any loot answer.
3. **Settle the coloring per-click mechanic**, then port `models/`.
4. **Retrieval**: live `search.json` first (zero storage, always current), plus a
   local embedding index over the ~16k non-Trading topics for paraphrase recall.
5. **Then** the AI layer — routing between the four sources, citations mandatory,
   backend-proxied, Discord-gated.
