/**
 * Loadout cost/damage engine — ported VERBATIM from Artemis-Tracker
 * (src/core/loadout.ts). The calculation functions are kept byte-identical so
 * the two stay in sync; see loadout.test.ts for the cross-parity tests.
 * Only the storage keys differ (namespaced to Cerberus).
 */

// ==================== Types ====================

export interface EquipmentEconomy {
  decay: number; // PED per shot (stored internally, displayed as PEC in UI)
  ammoBurn: number; // Raw ammo burn value (multiply by 0.0001 for PED)
  efficiency?: number; // Weapon efficiency stat (affects loot composition)
  absorption?: number; // Absorber: percentage of damage absorbed (0.1 = 10%)
}

export interface DamageProperties {
  stab: number;
  cut: number;
  impact: number;
  penetration: number;
  shrapnel: number;
  burn: number;
  cold: number;
  acid: number;
  electric: number;
}

export interface Equipment {
  name: string;
  economy: EquipmentEconomy;
  damage?: DamageProperties;
  range?: number; // Weapon range in meters
  usesPerMinute?: number; // Attack speed (shots per minute)
  maxTT?: number; // Max TT value in PED
  minTT?: number; // Min TT value in PED (repair threshold)
}

export interface ArmorSet {
  id: number;
  name: string;
  maxTT: number;
  durability: number;
  isLimited: boolean;
}

export interface ArmorPlate {
  name: string;
  maxTT: number;
  durability?: number;
}

export interface Loadout {
  id: string;
  name: string;

  weapon?: Equipment;
  amp?: Equipment;
  scope?: Equipment;
  sight?: Equipment;
  sight2?: Equipment;
  absorber?: Equipment;

  armor?: ArmorSet;
  armorPlates: ArmorPlate[];

  damageEnhancers: number;
  accuracyEnhancers: number;
  rangeEnhancers: number;
  economyEnhancers: number;

  weaponEnhancerSlots?: number;

  armorEnhancerSlots: number;

  weaponEnhancerCostOverride?: number;
  armorEnhancerCostOverride?: number;

  manualCostPerShot?: number;
  useManualCost: boolean;

  decayPerHit?: number;
  decayPerHeal?: number;

  hitProfession?: number;
  damageProfession?: number;

  createdAt: number;
  updatedAt: number;
}

export interface LoadoutCosts {
  weaponCost: number;
  ampCost: number;
  scopeCost: number;
  sightCost: number;
  sight2Cost: number;
  absorberCost: number;
  weaponEnhancerCost: number;
  armorEnhancerCost: number;
  totalPerShot: number;
  armorDecayPerHit: number;
}

export interface DamageRange {
  min: number;
  max: number;
}

// ==================== Constants ====================

const AMMOBURN_TO_PED = 0.0001;

const WEAPON_ENHANCER_AMMOBURN_PEC = 103;
const WEAPON_ENHANCER_COST_PED = WEAPON_ENHANCER_AMMOBURN_PEC * AMMOBURN_TO_PED;

// ==================== Pure Functions ====================

/** Calculate weapon range including range enhancers (+5% each, multiplicative). */
export function calculateRange(loadout: Loadout): number {
  if (!loadout.weapon) return 0;
  const baseRange = loadout.weapon.range ?? 0;
  const rangeEnhancers = loadout.rangeEnhancers || 0;
  return baseRange * (1 + 0.05 * rangeEnhancers);
}

/** Weapon/amp cost per shot (ammo burn → PED + decay). */
export function calculateWeaponCost(equipment?: Equipment): number {
  if (!equipment) return 0;
  const { ammoBurn, decay } = equipment.economy;
  return ammoBurn * AMMOBURN_TO_PED + decay;
}

/** Scope/sight cost per shot (decay only). */
export function calculateAttachmentCost(equipment?: Equipment): number {
  if (!equipment) return 0;
  return equipment.economy.decay;
}

export function calculateWeaponEnhancerCost(
  damageSlots: number,
  economySlots: number,
  override?: number,
): number {
  if (override !== undefined && override > 0) return override;
  const baseCost = damageSlots * WEAPON_ENHANCER_COST_PED;
  const economyMultiplier = Math.pow(0.989, economySlots);
  return baseCost * economyMultiplier;
}

/** Armor set decay per hit: MaxTT / Durability. */
export function calculateArmorDecayPerHit(armor?: ArmorSet): number {
  if (!armor) return 0;
  if (armor.durability <= 0) return 0;
  return armor.maxTT / armor.durability;
}

const DEFAULT_PLATE_DURABILITY = 1000;
export function calculateSinglePlateDecayPerHit(plates: ArmorPlate[]): number {
  if (!plates || plates.length === 0) return 0;
  let totalDecayRates = 0;
  for (const plate of plates) {
    const maxTT = plate.maxTT || 0;
    const durability = plate.durability || DEFAULT_PLATE_DURABILITY;
    if (durability > 0) {
      totalDecayRates += maxTT / durability;
    }
  }
  return totalDecayRates / plates.length;
}

export function isLimitedItem(name: string): boolean {
  return name.includes("(L)") || name.endsWith(" L");
}

/** Full loadout cost breakdown. Damage enhancers +10% weapon decay+ammo each;
 *  economy enhancers −1.1% weapon+amp each (multiplicative). */
export function calculateLoadoutCosts(loadout: Loadout): LoadoutCosts {
  const baseWeaponCost = calculateWeaponCost(loadout.weapon);
  const ampCost = calculateWeaponCost(loadout.amp);

  const scopeCost = calculateAttachmentCost(loadout.scope);
  const sightCost = calculateAttachmentCost(loadout.sight);
  const sight2Cost = calculateAttachmentCost(loadout.sight2);
  const absorberCost = calculateAttachmentCost(loadout.absorber);

  const damageEnhancers =
    (loadout.damageEnhancers || 0) + (loadout.weaponEnhancerSlots || 0);
  const economyEnhancers = loadout.economyEnhancers || 0;

  const damageMultiplier = 1 + damageEnhancers * 0.1;
  const weaponCostWithDamage = baseWeaponCost * damageMultiplier;

  const economyMultiplier = Math.pow(0.989, economyEnhancers);
  const finalWeaponCost = weaponCostWithDamage * economyMultiplier;
  const finalAmpCost = ampCost * economyMultiplier;

  const weaponEnhancerCost = 0;
  const armorEnhancerCost = loadout.armorEnhancerCostOverride ?? 0;
  const armorDecayPerHit = calculateArmorDecayPerHit(loadout.armor);

  return {
    weaponCost: finalWeaponCost,
    ampCost: finalAmpCost,
    scopeCost,
    sightCost,
    sight2Cost,
    absorberCost,
    weaponEnhancerCost,
    armorEnhancerCost,
    totalPerShot:
      finalWeaponCost +
      finalAmpCost +
      scopeCost +
      sightCost +
      sight2Cost +
      absorberCost +
      weaponEnhancerCost +
      armorEnhancerCost,
    armorDecayPerHit,
  };
}

export function calculateTotalDamage(equipment?: Equipment): number {
  if (!equipment?.damage) return 0;
  const d = equipment.damage;
  return (
    d.stab +
    d.cut +
    d.impact +
    d.penetration +
    d.shrapnel +
    d.burn +
    d.cold +
    d.acid +
    d.electric
  );
}

export function calculateEnhancedDamage(loadout: Loadout): DamageRange {
  if (!loadout.weapon) {
    return { min: 0, max: 0 };
  }

  const totalBaseDamage = calculateTotalDamage(loadout.weapon);

  const damageProfession = loadout.damageProfession ?? 100;
  const minDamageMultiplier = 0.25 + 0.25 * (damageProfession / 100);
  const weaponBaseMin = totalBaseDamage * minDamageMultiplier;
  const weaponBaseMax = totalBaseDamage * 1.0;

  const damageEnhancers =
    (loadout.damageEnhancers || 0) + (loadout.weaponEnhancerSlots || 0);
  const enhancerMultiplier = 1 + damageEnhancers * 0.1;

  let enhancedMin = weaponBaseMin * enhancerMultiplier;
  let enhancedMax = weaponBaseMax * enhancerMultiplier;

  if (loadout.amp?.damage) {
    const ampDamage = calculateTotalDamage(loadout.amp);
    const ampCap = Math.min(ampDamage, weaponBaseMin);

    enhancedMin += ampCap * 0.5;
    enhancedMax += ampCap * 1.0;
  }

  return { min: enhancedMin, max: enhancedMax };
}

export function calculateEffectiveDamage(loadout: Loadout): number {
  if (!loadout.weapon) return 0;

  const damage = calculateEnhancedDamage(loadout);
  const avgDamage = (damage.min + damage.max) / 2;

  const hitProf = loadout.hitProfession ?? 100;

  const hitAbility = hitProf / 100;
  const hitRate = 0.8 + hitAbility / 10;

  const critAbility = Math.sqrt(hitProf) / 10;
  const baseCritRate = (critAbility + 1) / 100;
  const accuracyBonus = (loadout.accuracyEnhancers || 0) * 0.002;
  const critRate = baseCritRate + accuracyBonus;
  const critDamage = damage.max * critRate;

  return avgDamage * hitRate + critDamage;
}

export function getHitRate(loadout: Loadout): number {
  const hitProf = loadout.hitProfession ?? 100;
  const hitAbility = hitProf / 100;
  return 0.8 + hitAbility / 10;
}

export function getCritRate(loadout: Loadout): number {
  const hitProf = loadout.hitProfession ?? 100;
  const critAbility = Math.sqrt(hitProf) / 10;
  const baseCritRate = (critAbility + 1) / 100;
  const accuracyBonus = (loadout.accuracyEnhancers || 0) * 0.002;
  return baseCritRate + accuracyBonus;
}

export function getModifiedDecay(loadout: Loadout): number {
  if (!loadout.weapon) return 0;

  const weaponDecay = loadout.weapon.economy.decay;
  const ampDecay = loadout.amp?.economy.decay ?? 0;

  const damageEnhancers =
    (loadout.damageEnhancers || 0) + (loadout.weaponEnhancerSlots || 0);
  const economyEnhancers = loadout.economyEnhancers || 0;

  const damageMultiplier = 1 + damageEnhancers * 0.1;
  const economyMultiplier = Math.pow(0.989, economyEnhancers);

  const modifiedWeaponDecay = weaponDecay * damageMultiplier * economyMultiplier;
  const modifiedAmpDecay = ampDecay * economyMultiplier;

  return modifiedWeaponDecay + modifiedAmpDecay;
}

export function getModifiedWeaponDecay(loadout: Loadout): number {
  if (!loadout.weapon) return 0;

  const weaponDecay = loadout.weapon.economy.decay;
  const damageEnhancers =
    (loadout.damageEnhancers || 0) + (loadout.weaponEnhancerSlots || 0);
  const economyEnhancers = loadout.economyEnhancers || 0;

  const damageMultiplier = 1 + damageEnhancers * 0.1;
  const economyMultiplier = Math.pow(0.989, economyEnhancers);

  return weaponDecay * damageMultiplier * economyMultiplier;
}

export function getModifiedAmmo(loadout: Loadout): number {
  if (!loadout.weapon) return 0;

  const baseAmmo = loadout.weapon.economy.ammoBurn;
  const damageEnhancers =
    (loadout.damageEnhancers || 0) + (loadout.weaponEnhancerSlots || 0);
  const economyEnhancers = loadout.economyEnhancers || 0;

  const damageMultiplier = 1 + damageEnhancers * 0.1;
  const economyMultiplier = Math.pow(0.989, economyEnhancers);

  return baseAmmo * damageMultiplier * economyMultiplier;
}

export function getTotalAmmo(loadout: Loadout): number {
  const weaponAmmo = getModifiedAmmo(loadout);
  const ampAmmo = loadout.amp?.economy.ammoBurn || 0;
  return weaponAmmo + ampAmmo;
}

export function getEfficiency(loadout: Loadout): number {
  if (!loadout.weapon) return 0;

  const damageEnhancers =
    (loadout.damageEnhancers || 0) + (loadout.weaponEnhancerSlots || 0);
  const economyEnhancers = loadout.economyEnhancers || 0;
  const damageMultiplier = 1 + damageEnhancers * 0.1;
  const economyMultiplier = Math.pow(0.989, economyEnhancers);

  const baseWeaponDecay = loadout.weapon.economy.decay ?? 0;
  const ampDecay = loadout.amp?.economy.decay ?? 0;

  const weaponDecay = baseWeaponDecay * damageMultiplier * economyMultiplier;

  const weaponEff = loadout.weapon.economy.efficiency ?? 0;
  const baseWeaponAmmo = (loadout.weapon.economy.ammoBurn ?? 0) * AMMOBURN_TO_PED;
  const weaponCost = weaponDecay + baseWeaponAmmo * damageMultiplier * economyMultiplier;

  const ampEff = loadout.amp?.economy.efficiency ?? 0;
  const ampCost = ampDecay + (loadout.amp?.economy.ammoBurn ?? 0) * AMMOBURN_TO_PED;

  const scopeEff = loadout.scope?.economy.efficiency ?? 0;
  const scopeCost = loadout.scope?.economy.decay ?? 0;

  const sightEff = loadout.sight?.economy.efficiency ?? 0;
  const sightCost = loadout.sight?.economy.decay ?? 0;

  const sight2Eff = loadout.sight2?.economy.efficiency ?? 0;
  const sight2Cost = loadout.sight2?.economy.decay ?? 0;

  const absorberEff = loadout.absorber?.economy.efficiency ?? 0;
  const absorberAbsorption = loadout.absorber?.economy.absorption ?? 0;
  const absorberCost = absorberAbsorption * (weaponDecay + ampDecay);

  const totalCost =
    weaponCost + ampCost + scopeCost + sightCost + sight2Cost + absorberCost;
  if (totalCost <= 0) return weaponEff / 100;

  const weightedSum =
    weaponEff * weaponCost +
    ampEff * ampCost +
    scopeEff * scopeCost +
    sightEff * sightCost +
    sight2Eff * sight2Cost +
    absorberEff * absorberCost;

  const combinedEfficiency = weightedSum / totalCost;
  return combinedEfficiency / 100;
}

export function calculateDPP(loadout: Loadout): number {
  const costPerShot = getEffectiveCostPerShot(loadout);
  if (costPerShot <= 0) return 0;

  const effectiveDamage = calculateEffectiveDamage(loadout);

  return effectiveDamage / costPerShot;
}

export function getEffectiveCostPerShot(loadout: Loadout): number {
  if (loadout.useManualCost && loadout.manualCostPerShot !== undefined) {
    return loadout.manualCostPerShot;
  }
  return calculateLoadoutCosts(loadout).totalPerShot;
}

export function createLoadout(name: string): Loadout {
  return {
    id: crypto.randomUUID(),
    name,
    armorPlates: [],
    damageEnhancers: 0,
    accuracyEnhancers: 0,
    rangeEnhancers: 0,
    economyEnhancers: 0,
    armorEnhancerSlots: 0,
    useManualCost: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function createEquipment(name: string, decay: number, ammoBurn = 0): Equipment {
  return { name, economy: { decay, ammoBurn } };
}

// ==================== Storage (Cerberus-namespaced) ====================

const STORAGE_KEY = "cerberus-loadouts";
const ACTIVE_KEY = "cerberus-active-loadout";

export function loadLoadouts(): Loadout[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? (JSON.parse(data) as Loadout[]) : [];
  } catch {
    return [];
  }
}

export function saveLoadouts(loadouts: Loadout[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loadouts));
  } catch {
    /* ignore */
  }
}

export function saveLoadout(loadout: Loadout): Loadout[] {
  const loadouts = loadLoadouts();
  const index = loadouts.findIndex((l) => l.id === loadout.id);
  const updated = { ...loadout, updatedAt: Date.now() };
  if (index >= 0) loadouts[index] = updated;
  else loadouts.push(updated);
  saveLoadouts(loadouts);
  return loadouts;
}

export function deleteLoadout(id: string): Loadout[] {
  const loadouts = loadLoadouts().filter((l) => l.id !== id);
  saveLoadouts(loadouts);
  return loadouts;
}

export function getActiveLoadoutId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveLoadoutId(id: string | null): void {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
}

export function getActiveLoadout(): Loadout | null {
  const activeId = getActiveLoadoutId();
  if (!activeId) return null;
  return loadLoadouts().find((l) => l.id === activeId) ?? null;
}
