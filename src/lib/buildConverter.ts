import type { Monster, Move, Personality } from "./types";
import type { Talent } from "./calculator";
import { DEFAULT_TALENT } from "./calculator";
import personalitiesData from "../data/personalities.json";
import monstersDetail from "../data/monsters_detail.json";

const personalities = personalitiesData as Personality[];
const detailMap = new Map((monstersDetail as Monster[]).map((m) => [m.id, m]));
const nameMap = new Map((monstersDetail as Monster[]).map((m) => [m.localized.zh.name, m]));

interface StatMarks {
  extremeStat: string;
  plusStats: string[];
  minusStat: string;
}

interface BuildConfig {
  creatureId: string;
  statMarks: StatMarks;
  selectedSkillNames: string[];
}

const STAT_TO_PERSONALITY: Record<string, keyof Personality> = {
  speed: "spd_mod_pct",
  hp: "hp_mod_pct",
  magicalAttack: "mag_atk_mod_pct",
  physicalAttack: "phy_atk_mod_pct",
  magicalDefense: "mag_def_mod_pct",
  physicalDefense: "phy_def_mod_pct",
};

const STAT_TO_TALENT: Record<string, keyof Talent> = {
  speed: "spd_boost",
  hp: "hp_boost",
  magicalAttack: "mag_atk_boost",
  physicalAttack: "phy_atk_boost",
  magicalDefense: "mag_def_boost",
  physicalDefense: "phy_def_boost",
};

export function convertStatMarks(statMarks: StatMarks): { personality: Personality; talent: Talent } {
  const plusKey = STAT_TO_PERSONALITY[statMarks.plusStats[0]];
  const minusKey = STAT_TO_PERSONALITY[statMarks.minusStat];

  const matched = personalities.find(
    (p) => (plusKey ? (p[plusKey] as number) > 0 : true) && (minusKey ? (p[minusKey] as number) < 0 : true)
  );
  const personality = matched || personalities[0];

  const talent = { ...DEFAULT_TALENT };
  for (let i = 0; i < 3 && i < statMarks.plusStats.length; i++) {
    const key = STAT_TO_TALENT[statMarks.plusStats[i]];
    if (key) talent[key] = 10;
  }

  return { personality, talent };
}

export function resolveSkillNames(monster: Monster, skillNames: string[]): Move[] {
  const detail = detailMap.get(monster.id);
  if (!detail || !detail.move_pool) return [];
  const pool = detail.move_pool as Move[];
  const result: Move[] = [];
  for (const name of skillNames) {
    const move = pool.find((m) => m.localized.zh.name === name);
    if (move) result.push(move);
  }
  return result;
}

export function convertBuild(build: BuildConfig): {
  monster: Monster | null;
  personality: Personality;
  talent: Talent;
  moves: Move[];
} {
  const monster = detailMap.get(parseInt(build.creatureId)) ?? nameMap.get(build.creatureId) ?? null;
  if (!monster) return { monster: null, personality: personalities[0], talent: DEFAULT_TALENT, moves: [] };

  const { personality, talent } = convertStatMarks(build.statMarks);
  const moves = resolveSkillNames(monster, build.selectedSkillNames);
  return { monster, personality, talent, moves };
}
