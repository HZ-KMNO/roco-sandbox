import type { Personality, Monster } from "./types";
import type { Talent } from "./calculator";
import { DEFAULT_TALENT } from "./calculator";
import popularStatMarks from "../data/popular_stat_marks.json";
import evolutionData from "../data/evolution_chains.json";
import monstersDetail from "../data/monsters_detail.json";
import { convertStatMarks } from "./buildConverter";

const marksMap = popularStatMarks as Record<string, { extremeStat: string; plusStats: string[]; minusStat: string }>;
const prevMap = (evolutionData as { prevMap: Record<string, number> }).prevMap;
// 首领反查：leader_form_id → 原形 id
const leaderFormToBaseMap = new Map<number, number>();
for (const m of monstersDetail as Monster[]) {
  if (m.leader_form_id) leaderFormToBaseMap.set(m.leader_form_id, m.id);
}

export function formatPersonality(p: Personality): string {
  const ups: string[] = [];
  const downs: string[] = [];
  const entries: [number, string][] = [
    [p.hp_mod_pct, "生命"], [p.phy_atk_mod_pct, "物攻"], [p.mag_atk_mod_pct, "魔攻"],
    [p.phy_def_mod_pct, "物防"], [p.mag_def_mod_pct, "魔防"], [p.spd_mod_pct, "速度"],
  ];
  for (const [v, l] of entries) {
    if (v > 0) ups.push(`加${l}`);
    else if (v < 0) downs.push(`减${l}`);
  }
  const detail = [...ups, ...downs].join("");
  return detail ? `${p.localized.zh}（${detail}）` : p.localized.zh;
}

/**
 * 沿进化链 + 首领变身反查推荐配置
 * 顺序：
 *   1. 当前 id 命中
 *   2. prevMap 上溯（如恶魔狼王无对应，但恶魔狼有）
 *   3. 首领反查：当前 id 是某只精灵的 leader_form_id → 借用原形配置
 *   4. 上溯过程中混合首领反查
 */
function lookupChainMarks(monsterId: number): { extremeStat: string; plusStats: string[]; minusStat: string } | null {
  const visited = new Set<number>();
  const tryIds = [monsterId];
  while (tryIds.length > 0) {
    const id = tryIds.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (marksMap[String(id)]) return marksMap[String(id)];
    // 上溯进化链
    const prev = prevMap[String(id)];
    if (prev !== undefined && !visited.has(prev)) tryIds.push(prev);
    // 首领反查
    const base = leaderFormToBaseMap.get(id);
    if (base !== undefined && !visited.has(base)) tryIds.push(base);
  }
  return null;
}

export function getPopularPersonality(monsterId: number): Personality | null {
  const marks = lookupChainMarks(monsterId);
  if (!marks) return null;
  return convertStatMarks(marks).personality;
}

export function getPopularTalent(monsterId: number): Talent {
  const marks = lookupChainMarks(monsterId);
  if (!marks) return DEFAULT_TALENT;
  return convertStatMarks(marks).talent;
}
