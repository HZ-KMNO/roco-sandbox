/**
 * 伤害反推引擎 — 从观测值反向求解敌方攻击数值
 *
 * 公式（来自 calculator.ts）：
 *   damage = floor(round(atk × power × stab × eff × 37/41) / def)
 *
 * 反推：
 *   atk ≈ damage × def / (power × stab × eff × 37/41)
 *
 * 由于 floor 取整，单次观测得到的是一个区间 [atk_min, atk_max]
 * 多次观测取交集 → 区间持续收窄
 */

import type { DamageObservation } from "./observations";
import type { Monster, Personality } from "./types";
import { getAllObservations } from "./observations";
import { calcStats, DEFAULT_TALENT } from "./calculator";
import personalitiesData from "../data/personalities.json";

const PERSONALITIES = personalitiesData as Personality[];

export interface AttackerStatRange {
  attackerName: string;
  phyAtk?: { min: number; max: number };
  magAtk?: { min: number; max: number };
  confidence: number;       // 观测次数（次数越多区间越窄）
  observations: number;
}

const LEVEL_COEFF = 37 / 41;

/**
 * 单次观测反求 atk 区间（开区间转闭区间近似）
 *
 * @param damage 观测到的伤害
 * @param def 防守方防御
 * @param power 技能威力
 * @param stab 是否同系（true→1.25）
 * @param eff 属性克制系数
 */
export function solveAttackerAtk(
  damage: number,
  def: number,
  power: number,
  stab: boolean,
  eff: number,
): { min: number; max: number } | null {
  if (power <= 0 || def <= 0) return null;
  const stabMod = stab ? 1.25 : 1.0;
  const displayPower = Math.round(power * stabMod * eff);
  if (displayPower <= 0) return null;
  // damage = floor(X / def)，其中 X = round(atk × displayPower × LEVEL_COEFF)
  // 所以 X ∈ [damage*def, damage*def + def - 1]
  // round(Y) = X 意味 Y ∈ [X-0.5, X+0.5)
  // 即 atk × displayPower × LEVEL_COEFF ∈ [X-0.5, X+0.5)
  // atk ∈ [(X-0.5) / (displayPower × LEVEL_COEFF), (X+0.5) / ... )
  const xMin = damage * def;
  const xMax = damage * def + def - 1;
  const denom = displayPower * LEVEL_COEFF;
  const atkMin = (xMin - 0.5) / denom;
  const atkMax = (xMax + 0.5) / denom;
  return { min: Math.max(1, Math.floor(atkMin)), max: Math.ceil(atkMax) };
}

/**
 * 取两区间交集
 */
function intersect(
  a: { min: number; max: number } | undefined,
  b: { min: number; max: number },
): { min: number; max: number } {
  if (!a) return b;
  return { min: Math.max(a.min, b.min), max: Math.min(a.max, b.max) };
}

/**
 * 估算敌方某只精灵的攻击数值
 * 综合所有该精灵作为 attacker 的观测，按 move category（物攻/魔攻）分组取交集
 */
export function estimateAttackerStats(attackerName: string): AttackerStatRange {
  const obs = getAllObservations().filter(
    (o) => o.attackerName === attackerName && o.attackerSide === "enemy",
  );
  let phyAtk: { min: number; max: number } | undefined;
  let magAtk: { min: number; max: number } | undefined;
  let valid = 0;
  for (const o of obs) {
    if (!o.movePower || !o.defenderDef) continue;
    const range = solveAttackerAtk(
      o.observedDamage,
      o.defenderDef,
      o.movePower,
      o.stab || false,
      o.typeEffectiveness ?? 1,
    );
    if (!range) continue;
    if (o.moveCategory === "Physical Attack") {
      phyAtk = intersect(phyAtk, range);
    } else if (o.moveCategory === "Magic Attack") {
      magAtk = intersect(magAtk, range);
    }
    valid++;
    // 区间退化（min > max）说明观测不一致 → 重置
    if (phyAtk && phyAtk.min > phyAtk.max) phyAtk = range;
    if (magAtk && magAtk.min > magAtk.max) magAtk = range;
  }
  return {
    attackerName,
    phyAtk,
    magAtk,
    confidence: valid,
    observations: obs.length,
  };
}

/**
 * 用估算的攻击数值预测后续伤害（取区间中点）
 */
export function predictDamageWithEstimate(
  estimate: AttackerStatRange,
  category: "Physical Attack" | "Magic Attack",
  def: number,
  power: number,
  stab: boolean,
  eff: number,
): { min: number; max: number } | null {
  const range = category === "Physical Attack" ? estimate.phyAtk : estimate.magAtk;
  if (!range) return null;
  const stabMod = stab ? 1.25 : 1.0;
  const displayPower = Math.round(power * stabMod * eff);
  const calc = (atk: number) =>
    Math.floor(Math.round(atk * displayPower * LEVEL_COEFF) / def);
  return { min: calc(range.min), max: calc(range.max) };
}

/**
 * 反推性格名 — 给定攻击区间中点和精灵种族值，找最接近的性格
 *
 * @param monster 精灵（用于种族值）
 * @param atkMid 推测的 atk 数值（取区间中点）
 * @param category 物攻 / 魔攻
 * @returns 性格名（中文），含 confidence 标注；无候选时 null
 */
export function estimatePersonalityName(
  monster: Monster,
  atkMid: number,
  category: "Physical Attack" | "Magic Attack",
): { zh: string; confidence: "high" | "medium" | "low" } | null {
  const statKey = category === "Physical Attack" ? "phyAtk" : "magAtk";
  const targetMod = category === "Physical Attack" ? "phy_atk_mod_pct" : "mag_atk_mod_pct";

  // 候选 = 该攻击 +20% 的性格（5 个）+ 中性 + 该攻击 -10% 的性格
  const candidates = PERSONALITIES.filter((p) => p[targetMod] >= 0 || p[targetMod] === -0.1);

  // 测试两种典型个体配置：全 0 / 该攻击主项 +10
  const talentVariants = [
    DEFAULT_TALENT,
    { ...DEFAULT_TALENT, [category === "Physical Attack" ? "phy_atk_boost" : "mag_atk_boost"]: 10 },
  ];

  let bestZh = "";
  let bestDiff = Infinity;
  for (const p of candidates) {
    for (const tal of talentVariants) {
      const stats = calcStats(monster, p, tal);
      const v = stats[statKey];
      const diff = Math.abs(v - atkMid);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestZh = p.localized.zh;
      }
    }
  }
  if (!bestZh) return null;
  // 误差 ≤3 高置信，≤8 中，>8 低
  const confidence: "high" | "medium" | "low" =
    bestDiff <= 3 ? "high" : bestDiff <= 8 ? "medium" : "low";
  return { zh: bestZh, confidence };
}

// 给观测记录器传 calculator 上下文需要这些字段（在 observations.ts 里也要补）
export type _ObservationWithContext = DamageObservation & {
  movePower?: number;
  moveCategory?: string;
  stab?: boolean;
  typeEffectiveness?: number;
  defenderDef?: number;
};
