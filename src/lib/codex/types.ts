// Typed models for the bundled Nexus snapshot (see scripts/build-nexus-snapshot.mjs).
// Shapes mirror the Entropia Nexus API: every resource carries Links.$Url and
// relationships are embedded { Name, Links.$Url } refs.

/** An embedded reference to another resource — the wiki's deep-dive link. */
export interface Ref {
  Name: string | null;
  Properties?: { Type?: string; Economy?: Economy };
  Links?: { $Url?: string };
}

export interface Economy {
  Value?: number | null;
  MaxTT?: number | null;
  MinTT?: number | null;
  Decay?: number | null;
  AmmoBurn?: number | null;
  Efficiency?: number | null;
}

/** The nine EU damage types; also used for a maturity's defenses. */
export interface Damage {
  Stab?: number | null;
  Cut?: number | null;
  Impact?: number | null;
  Penetration?: number | null;
  Shrapnel?: number | null;
  Burn?: number | null;
  Cold?: number | null;
  Acid?: number | null;
  Electric?: number | null;
}

export interface ItemProps {
  Description?: string | null;
  Type?: string;
  Weight?: number | null;
  Category?: string;
  Class?: string;
  UsesPerMinute?: number | null;
  Range?: number | null;
  Economy?: Economy;
  Damage?: Damage;
  IsUntradeable?: boolean;
  IsRare?: boolean;
}

export interface NexusItem {
  Id: number;
  ItemId?: number;
  Name: string;
  Properties: ItemProps;
  Ammo?: Ref;
  ProfessionHit?: Ref;
  ProfessionDmg?: Ref;
  Links: { $Url: string };
}

export interface BlueprintMaterial {
  Amount: number;
  Item: Ref;
}

export interface Blueprint {
  Id: number;
  Name: string;
  Properties: {
    Type: string;
    Level: number;
    IsBoosted: boolean;
    MinimumCraftAmount: number;
    MaximumCraftAmount: number | null;
  };
  Profession: Ref;
  Book: Ref;
  Product: Ref;
  Materials: BlueprintMaterial[];
  Links: { $Url: string };
}

export interface RefiningRecipe {
  Id: number;
  Amount: number;
  Ingredients: BlueprintMaterial[];
  Product: Ref;
  Links: { $Url: string };
}

export interface MaturityStats {
  Health?: number | null;
  AttacksPerMinute?: number | null;
  Level?: number | null;
  Attributes?: Record<string, number | null>;
  Defense?: Damage;
  Taming?: { IsTameable?: boolean; TamingLevel?: number | null };
}

export interface Maturity {
  Id: number;
  Name: string;
  Properties: MaturityStats;
  Links?: { $Url?: string };
}

export interface MobLoot {
  Maturity?: Ref;
  Item: Ref;
  Frequency?: string;
  LastVU?: string;
  IsEvent?: boolean;
  IsDropping?: boolean;
}

export interface MobSpawn {
  Id: number;
  Name: string;
  Properties?: {
    Density?: number | null;
    Coordinates?: { Longitude?: number; Latitude?: number; Altitude?: number };
  };
  Planet?: Ref;
}

export interface Mob {
  Id: number;
  Name: string;
  Type?: string;
  Properties: {
    Description?: string | null;
    IsSweatable?: boolean | null;
  };
  DefensiveProfession?: Ref;
  ScanningProfession?: Ref;
  Planet?: Ref;
  Species?: Ref;
  Maturities: Maturity[];
  Spawns?: MobSpawn[];
  Loots?: MobLoot[];
  Links: { $Url: string };
}

/** One item→mob drop row from the precomputed reverse index. */
export interface Drop {
  mobName: string;
  mobId: number;
  maturity: string | null;
  frequency: string;
  planet: string;
  isDropping: boolean;
  lastVU: string;
}

/** A row in the up-front search index. */
export interface SearchEntry {
  name: string;
  url: string;
  kind: string;
  tt: number | null;
}

/** A node in a recursive crafting material tree. */
export interface CraftNode {
  name: string;
  amount: number;
  type: string;
  url?: string;
  craftable: boolean;
  profession?: string;
  level?: number;
  children?: CraftNode[];
}

export type Resolved =
  | { kind: "item"; item: NexusItem }
  | { kind: "mob"; mob: Mob }
  | { kind: "unknown"; url: string };

/** A slim crafting edge (bundled craft-index.json) — the client recurses over
 *  these to build the material tree without full blueprint objects. */
export interface CraftEntry {
  u: string | null; // product $Url
  p: string | null; // profession
  l: number | null; // level
  q: number; // minimum craft amount
  m: { n: string; a: number; u: string | null }[]; // materials
}

/** A blueprint that consumes some material (reverse "used to craft"). */
export interface UsedIn {
  name: string;
  url: string | null;
  profession: string | null;
  level: number | null;
}
