import type { Monster, Personality, TypeInfo } from "./types";

export interface Talent {
  hp_boost: number;
  phy_atk_boost: number;
  mag_atk_boost: number;
  phy_def_boost: number;
  mag_def_boost: number;
  spd_boost: number;
}

export const DEFAULT_TALENT: Talent = {
  hp_boost: 0,
  phy_atk_boost: 0,
  mag_atk_boost: 0,
  phy_def_boost: 0,
  mag_def_boost: 0,
  spd_boost: 0,
};

export interface Stats {
  hp: number;
  phyAtk: number;
  magAtk: number;
  phyDef: number;
  magDef: number;
  spd: number;
}

export function calcStats(
  monster: Monster,
  personality: Personality,
  talent: Talent = DEFAULT_TALENT
): Stats {
  const calcHp = (base: number, boost: number, mod: number) => {
    const raw = Math.round(170 * (base + 3 * boost) / 100 + 70);
    return Math.round(raw * (1 + mod) + 100);
  };
  const calcStat = (base: number, boost: number, mod: number) => {
    const raw = Math.round(110 * (base + 3 * boost) / 100 + 10);
    return Math.round(raw * (1 + mod) + 50);
  };

  return {
    hp: calcHp(monster.base_hp, talent.hp_boost, personality.hp_mod_pct),
    phyAtk: calcStat(monster.base_phy_atk, talent.phy_atk_boost, personality.phy_atk_mod_pct),
    magAtk: calcStat(monster.base_mag_atk, talent.mag_atk_boost, personality.mag_atk_mod_pct),
    phyDef: calcStat(monster.base_phy_def, talent.phy_def_boost, personality.phy_def_mod_pct),
    magDef: calcStat(monster.base_mag_def, talent.mag_def_boost, personality.mag_def_mod_pct),
    spd: calcStat(monster.base_spd, talent.spd_boost, personality.spd_mod_pct),
  };
}

export function getTypeEffectiveness(
  attackType: string,
  defenderTypes: TypeInfo[]
): number {
  let countWeak = 0;
  let countResist = 0;
  for (const defType of defenderTypes) {
    if (defType.vulnerable_to.includes(attackType)) {
      countWeak += 1;
    } else if (defType.resistant_to.includes(attackType)) {
      countResist += 1;
    }
  }
  // 克制叠加: 1 + N(弱点数), 抵抗相乘: ×0.5^N
  // 克制1个=2, 克制2个=3, 抵抗1个=0.5, 抵抗2个=0.25, 1克+1抗=中性1.0
  return (1 + countWeak) * Math.pow(0.5, countResist);
}

export interface DamageResult {
  min: number;
  max: number;
  effectiveness: number;
}

export function calcDamage(
  attackerAtk: number,
  defenderDef: number,
  movePower: number,
  typeEffectiveness: number,
  stab: boolean = false
): DamageResult {
  const stabMod = stab ? 1.25 : 1.0;
  const displayPower = Math.round(movePower * stabMod * typeEffectiveness);
  const levelCoeff = 37 / 41; // (60*45/100+10)/41 at max level 60
  const damage =
    defenderDef <= 0
      ? 0
      : Math.floor(
          Math.round(attackerAtk * displayPower * levelCoeff) / defenderDef
        );

  return {
    min: damage,
    max: damage,
    effectiveness: typeEffectiveness,
  };
}
