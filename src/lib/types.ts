export interface MonsterType {
  id: number;
  name: string;
  localized: { zh: string };
}

export interface Trait {
  id: number;
  name: string;
  description: string;
  localized: { zh: { name: string; description: string } };
  allows_duplicate_moves: boolean | null;
}

export interface Monster {
  id: number;
  name: string;
  form: string;
  main_type: MonsterType;
  sub_type: MonsterType | null;
  default_legacy_type: MonsterType;
  leader_potential: boolean;
  is_leader_form: boolean;
  preferred_attack_style: "Physical" | "Magic" | "Both";
  localized: { zh: { name: string } };
  base_hp: number;
  base_phy_atk: number;
  base_mag_atk: number;
  base_phy_def: number;
  base_mag_def: number;
  base_spd: number;
  evolves_from_id: number | null;
  leader_form_id?: number | null;
  dex_number: number;
  species?: { id: number; name: string; localized: { zh: string } };
  trait?: Trait;
  move_pool?: Move[];
}

export interface Move {
  id: number;
  name: string;
  move_type: MonsterType | null;
  localized: { zh: { name: string; description: string } };
  move_category: "Physical Attack" | "Magic Attack" | "Status" | "Defense";
  energy_cost: number;
  power: number | null;
  base_combo: number | null;
  counter_power_multiplier: number | null;
  alt_power_total: number | null;
  alt_condition_zh: string | null;
  alt_condition_en: string | null;
  power_formula: string | null;
  description: string;
  statuses: unknown[];
}

export interface TypeInfo {
  id: number;
  name: string;
  localized: { zh: string };
  vulnerable_to: string[];
  resistant_to: string[];
}

export interface Personality {
  id: number;
  name: string;
  hp_mod_pct: number;
  phy_atk_mod_pct: number;
  mag_atk_mod_pct: number;
  phy_def_mod_pct: number;
  mag_def_mod_pct: number;
  spd_mod_pct: number;
  localized: { zh: string };
}
