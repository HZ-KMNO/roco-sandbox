/**
 * 官方分享格式解析 — QuickImport / FeaturedTeams 共享
 *
 * 输入：# 海豹船长：武系血脉、{斩断、听桥、力量增效、水刃}
 * 输出：{ monster, personality, talent, selectedMoves, bloodline } 或 null
 *
 * 也解析魔法行：# 魔法：进化之力 → 独立导出 parseMagicItemLine
 */

import type { Monster, Move, Personality } from "./types";
import type { Talent } from "./calculator";
import { DEFAULT_TALENT } from "./calculator";
import { getPopularPersonality, getPopularTalent } from "./popularStats";
import monstersDetail from "../data/monsters_detail.json";
import allMovesData from "../data/moves.json";
import typesData from "../data/types.json";

const allMoves = allMovesData as Move[];
const types = (typesData as { id: number; name: string; localized: { zh: string } }[]).filter(
  (t) => t.name !== "Leader",
);

const TYPE_ZH_TO_EN: Record<string, string> = Object.fromEntries(
  types.map((t) => [t.localized.zh, t.name]),
);
// 首领不在 types 里（被过滤掉了），手动加
TYPE_ZH_TO_EN["首领"] = "Leader";

export interface ParsedTeamLine {
  monster: Monster;
  personality: Personality | null;
  talent: Talent;
  selectedMoves: Move[];
  bloodline: Monster["default_legacy_type"] | null;
}

/**
 * 从公式文本中提取魔法道具名 "# 魔法：进化之力"
 */
export function parseMagicItemLine(text: string): string | null {
  const m = text.match(/#\s*魔法[：:]\s*(\S+)/);
  return m ? m[1].trim() : null;
}

/**
 * 解析单行官方注释格式
 * "# 海豹船长：武系血脉、{斩断、听桥、力量增效、水刃}"
 */
export function parseOfficialTeamLine(line: string): ParsedTeamLine | null {
  const m = line.match(/^#\s*([^：:]+)[：:]\s*([^、]+)血脉\s*[、,]\s*\{([^}]+)\}/);
  if (!m) return null;

  const monsterName = m[1].trim();
  // 去"系"后缀：武系→武，水系→水
  const bloodlineZh = m[2].trim().replace(/系$/, "");
  const skillNames = m[3].split(/[、,，]/).map((s) => s.trim()).filter(Boolean);

  let monster: Monster | undefined;
  // 1. 精确匹配
  for (const mon of (monstersDetail as Monster[])) {
    if (mon.localized.zh.name === monsterName) { monster = mon; break; }
  }
  // 2. 包含匹配 + 血脉提示
  if (!monster) {
    const candidates = (monstersDetail as Monster[]).filter(
      (mm) => mm.localized.zh.name.includes(monsterName),
    );
    if (bloodlineZh === "首领") {
      monster = candidates.find((mm) => mm.leader_potential)
        || candidates.find((mm) => /陛下|王$|领主/.test(mm.localized.zh.name))
        || candidates[0];
    } else {
      monster = candidates.find((mm) => !mm.leader_potential && !mm.is_leader_form)
        || candidates[0];
    }
  }
  if (!monster) return null;

  // 技能（保留重复）
  const pool = (monster.move_pool || []) as Move[];
  const selectedMoves: Move[] = [];
  for (const skill of skillNames) {
    if (selectedMoves.length >= 4) break;
    const mv = pool.find((p) => p.localized.zh.name === skill)
      || allMoves.find((p) => p.localized.zh.name === skill);
    if (mv) selectedMoves.push(mv);
  }

  // 血脉
  const bloodlineEnName = TYPE_ZH_TO_EN[bloodlineZh];
  const bloodline = bloodlineEnName
    ? types.find((t) => t.name === bloodlineEnName) || null
    : null;

  // 推荐配置（沿进化链 + 首领反查）
  const personality = getPopularPersonality(monster.id);
  const talent = getPopularTalent(monster.id);

  return {
    monster,
    personality: personality || null,
    talent: talent || DEFAULT_TALENT,
    selectedMoves,
    bloodline: bloodline as Monster["default_legacy_type"] | null,
  };
}
