/**
 * 拼音首字母搜索工具
 *
 * 用法：
 *   matchPinyinName("筛管奔流", "s")   → true  (首字母s)
 *   matchPinyinName("筛管奔流", "sg")  → true  (前两字首字母)
 *   matchPinyinName("筛管奔流", "sgb") → true  (前三字)
 *   matchPinyinName("筛管奔流", "x")   → false
 *   matchPinyinName("迪莫", "d")       → true
 *   matchPinyinName("迪莫", "dm")      → true
 *
 * 同时支持中文直接匹配 + 拼音首字母匹配
 */

import { PINYIN_MAP, getPinyinInitials } from "../data/pinyin_data";
import monsterPinyin from "../data/monster_pinyin.json";
import skillPinyin from "../data/skill_pinyin.json";

const monsterPy: Record<string, string> = monsterPinyin;
const skillPy: Record<string, string> = skillPinyin;

export { PINYIN_MAP, getPinyinInitials };

/** 检查文字拼音首字母是否匹配查询 */
export function matchPinyinInitials(text: string, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const py = getPinyinInitials(text);
  // 前缀匹配（如 "s" 匹配 "sgbl"）
  if (py.startsWith(q)) return true;
  // 任意位置包含（如 "bl" 可以搜到 筛管奔流 中的 奔流）
  if (py.includes(q)) return true;
  return false;
}

/** 检查怪物名是否匹配（中文 + 拼音） */
export function matchMonsterName(name: string, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (name.toLowerCase().includes(q)) return true;
  return matchPinyinInitials(name, q);
}

/** 检查技能名是否匹配 */
export function matchSkillName(name: string, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (name.includes(q)) return true;
  if (name.toLowerCase().includes(q)) return true;
  return matchPinyinInitials(name, q);
}

/** 获取怪物拼音首字母 */
export function getMonsterPinyin(id: number): string {
  return monsterPy[String(id)] || "";
}

/** 获取技能拼音首字母 */
export function getSkillPinyin(id: number): string {
  return skillPy[String(id)] || "";
}
