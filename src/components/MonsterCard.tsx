import { useState } from "react";
import type { Monster, Personality, Move, TypeInfo, MonsterType } from "../lib/types";
import { calcStats } from "../lib/calculator";
import type { Talent } from "../lib/calculator";
import { MoveSearch } from "./MoveSearch";
import personalitiesData from "../data/personalities.json";
import typesData from "../data/types.json";
import traitNamesZh from "../data/trait_names_zh.json";
import { TYPE_COLORS, typeDotBg } from "../lib/typeColors";
import monstersDetail from "../data/monsters_detail.json";
import allMovesData from "../data/moves.json";
import { formatPersonality } from "../lib/popularStats";

const detailMap = new Map((monstersDetail as Monster[]).map((m) => [m.id, m]));
const personalities = personalitiesData as Personality[];
const traitZhMap = traitNamesZh as Record<string, string>;
const allMoves = allMovesData as Move[];
// 去重：确保全局技能列表中只保留唯一的技能
const allMovesUnique = allMoves.filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i);
// 三种随机技能ID
const RANDOM_SKILL_IDS = [16, 27, 46]; // 复写, 借用, 取念

const TALENT_KEYS: { key: keyof Talent; label: string }[] = [
  { key: "hp_boost", label: "生命" },
  { key: "phy_atk_boost", label: "物攻" },
  { key: "mag_atk_boost", label: "魔攻" },
  { key: "phy_def_boost", label: "物防" },
  { key: "mag_def_boost", label: "魔防" },
  { key: "spd_boost", label: "速度" },
];

const STAT_COLORS = ["text-green-600", "text-red-600", "text-purple-600", "text-amber-600", "text-teal-600", "text-blue-600"];
const BAR_COLORS = ["bg-green-500", "bg-red-500", "bg-purple-500", "bg-amber-500", "bg-teal-500", "bg-blue-500"];

interface Props {
  monster: Monster;
  personality: Personality | null;
  onPersonalityChange: (p: Personality) => void;
  talent: Talent;
  onTalentChange: (t: Talent) => void;
  movePool: Move[];
  selectedMoves: Move[];
  onMovesChange: (moves: Move[]) => void;
  bloodline: MonsterType | null;
  onBloodlineChange: (bl: MonsterType | null) => void;
  captureBall?: string | null;
  onCaptureBallChange?: (ball: string | null) => void;
  beastBloodline?: string | null;
  onBeastBloodlineChange?: (bl: string | null) => void;
}

export function MonsterCard({ monster, personality, onPersonalityChange, talent, onTalentChange, movePool, selectedMoves, onMovesChange, bloodline, onBloodlineChange, captureBall, onCaptureBallChange, beastBloodline, onBeastBloodlineChange }: Props) {
  const currentPersonality = personality || personalities[0];
  const stats = calcStats(monster, currentPersonality, talent);
  const activeTalentCount = TALENT_KEYS.filter((t) => talent[t.key] > 0).length;
  const [showAllMoves, setShowAllMoves] = useState(false);
  const effectivePool = showAllMoves ? allMovesUnique : movePool;

  const toggleTalent = (key: keyof Talent) => {
    const isActive = talent[key] > 0;
    if (!isActive && activeTalentCount >= 3) return;
    onTalentChange({ ...talent, [key]: isActive ? 0 : 10 });
  };

  const statItems = [
    { label: "生命", base: monster.base_hp, final: stats.hp },
    { label: "物攻", base: monster.base_phy_atk, final: stats.phyAtk },
    { label: "魔攻", base: monster.base_mag_atk, final: stats.magAtk },
    { label: "物防", base: monster.base_phy_def, final: stats.phyDef },
    { label: "魔防", base: monster.base_mag_def, final: stats.magDef },
    { label: "速度", base: monster.base_spd, final: stats.spd },
  ];

  const totalBase = statItems.reduce((s, i) => s + i.base, 0);

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-3 shadow-sm space-y-2">
      {/* Header: name + type + trait */}
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-bold text-zinc-900" title={(() => { const d = detailMap.get(monster.id); return d?.trait ? `${d.trait.localized.zh.name}：${d.trait.localized.zh.description}` : ""; })()}>{monster.localized.zh.name}</h3>
        <div className="flex gap-1 items-center">
          <span className={`text-xs px-1.5 py-0.5 rounded-full inline-flex items-center gap-1 ${typeDotBg(monster.main_type.name)}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${TYPE_COLORS[monster.main_type.name]?.dot || "bg-zinc-400"}`} />
            {monster.main_type.localized.zh}
          </span>
          {monster.sub_type && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full inline-flex items-center gap-1 ${typeDotBg(monster.sub_type.name)}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${TYPE_COLORS[monster.sub_type.name]?.dot || "bg-zinc-400"}`} />
              {monster.sub_type.localized.zh}
            </span>
          )}
          {monster.trait && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              {traitZhMap[monster.trait.name] || monster.trait.name}
            </span>
          )}
          {/* 咕噜球选择器 (仅契约的形状) */}
          {onCaptureBallChange && (monster.trait?.localized.zh.name === "契约的形状" || monster.trait?.name === "契约的形状") && (
            <select value={captureBall || "普通球"} onChange={e => onCaptureBallChange(e.target.value || null)}
              className="text-xs border border-sky-200 rounded px-1 py-0.5 bg-sky-50 text-sky-700 max-w-[100px] truncate" title="咕噜球类型">
              {["普通球","高级球","国王球","美妙球","调温球","光合球","网兜球","绝缘球","淘沙球","变幻球","暗星球","好战球","捕光球","棱镜球"].map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          )}
          {/* 血脉选择器 (仅稀兽花宝) */}
          {onBeastBloodlineChange && (monster.trait?.localized.zh.name === "稀兽花宝" || monster.trait?.name === "稀兽花宝") && (
            <select value={beastBloodline || ""} onChange={e => onBeastBloodlineChange(e.target.value || null)}
              className="text-xs border border-emerald-200 rounded px-1 py-0.5 bg-emerald-50 text-emerald-700 max-w-[100px] truncate" title="选择血脉类型">
              <option value="">选血脉</option>
              {["电","光","冰","普通","虫","翼","幽灵","草","水","萌","龙","毒","地","幻","恶","机械","火","武"].map(b => (
                <option key={b} value={b}>{b}系</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Compact stats: 6-column grid with mini bars */}
      <div className="grid grid-cols-6 gap-1 text-center">
        {statItems.map((s, i) => (
          <div key={s.label} className="space-y-0.5">
            <div className="text-xs text-zinc-400">{s.label}</div>
            <div className={`text-xs font-mono font-medium ${STAT_COLORS[i]}`}>{s.final}</div>
            <div className="h-0.5 rounded-full bg-zinc-100 overflow-hidden">
              <div className={`h-full ${BAR_COLORS[i]} rounded-full`} style={{ width: `${Math.min((s.base / 200) * 100, 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="text-xs text-zinc-400 text-right">合计 {totalBase}</div>

      {/* Personality + Talent in one row */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={currentPersonality.id}
          onChange={(e) => {
            const p = personalities.find((x) => x.id === Number(e.target.value));
            if (p) onPersonalityChange(p);
          }}
          className="text-xs border border-zinc-200 rounded px-1.5 py-1"
        >
          {personalities.map((p) => (
            <option key={p.id} value={p.id}>{formatPersonality(p)}</option>
          ))}
        </select>
        <select
          value={bloodline?.name || monster.default_legacy_type?.name || monster.main_type.name}
          onChange={(e) => {
            const t = (typesData as TypeInfo[]).find((x: TypeInfo) => x.name === e.target.value);
            onBloodlineChange(t ? { id: t.id, name: t.name, localized: t.localized } : null);
          }}
          className="text-xs border border-zinc-200 rounded px-1.5 py-1"
          title="血脉选择"
        >
          <option value={monster.default_legacy_type?.name || monster.main_type.name}>{monster.default_legacy_type?.localized?.zh || monster.main_type.localized.zh}血脉（默认）</option>
          {typesData.filter((t: TypeInfo) => t.name !== (monster.default_legacy_type?.name || monster.main_type.name)).map((t: TypeInfo) => (
            <option key={t.name} value={t.name}>{t.localized.zh}血脉</option>
          ))}
        </select>
        <div className="flex gap-0.5">
          {TALENT_KEYS.map((t) => {
            const active = talent[t.key] > 0;
            const disabled = !active && activeTalentCount >= 3;
            return (
              <button key={t.key} onClick={() => toggleTalent(t.key)} disabled={disabled}
                className={`text-xs px-1.5 py-0.5 rounded-full border transition-colors ${
                  active ? "bg-indigo-100 border-indigo-300 text-indigo-700"
                    : disabled ? "bg-zinc-50 border-zinc-100 text-zinc-300 cursor-not-allowed"
                    : "bg-white border-zinc-200 text-zinc-500 hover:border-indigo-200"
                }`}>{t.label}</button>
            );
          })}
        </div>
        <span className="text-xs text-zinc-400">{activeTalentCount}/3</span>
        {activeTalentCount >= 3 && (() => {
          // 天分等级判定
          const persStatMap: Record<string, string> = { hp_mod_pct: "生命", phy_atk_mod_pct: "物攻", mag_atk_mod_pct: "魔攻", phy_def_mod_pct: "物防", mag_def_mod_pct: "魔防", spd_mod_pct: "速度" };
          const talentStatMap: Record<string, string> = { hp_boost: "生命", phy_atk_boost: "物攻", mag_atk_boost: "魔攻", phy_def_boost: "物防", mag_def_boost: "魔防", spd_boost: "速度" };
          // Find the personality's +10% stat
          const plusStat = Object.entries(currentPersonality).find(([k, v]) => k.endsWith("_mod_pct") && v > 0)?.[0] || "";
          const plusStatName = persStatMap[plusStat] || "";
          // Find which stats have talent boosts
          const talentStats = TALENT_KEYS.filter(t => talent[t.key] > 0).map(t => talentStatMap[t.key] || t.label);
          // Check if any talent boost matches personality boost
          const hasMatch = talentStats.some(s => s === plusStatName);
          const grade = hasMatch ? "了不起" : "相当好";
          const gradeColor = hasMatch ? "bg-amber-100 text-amber-700 border-amber-300" : "bg-blue-100 text-blue-600 border-blue-200";
          const hint = hasMatch
            ? `天分「了不起」：天赋(${talentStats.join("、")})包含性格加成项(${plusStatName})`
            : `天分「相当好」：天赋(${talentStats.join("、")})未包含性格加成项(${plusStatName})`;
          return <span className={`text-xs px-1.5 py-0.5 rounded-full border font-medium ${gradeColor}`} title={hint}>{grade}</span>;
        })()}
      </div>

      {/* Moves */}
      <div className="border-t border-zinc-100 pt-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-zinc-400">技能 ({selectedMoves.length}/4) + 聚能</span>
          <button
            onClick={() => setShowAllMoves(!showAllMoves)}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
              showAllMoves
                ? "bg-amber-100 border-amber-300 text-amber-700"
                : "bg-white border-zinc-200 text-zinc-500 hover:border-zinc-300"
            }`}
            title={showAllMoves ? "当前：全技能库（含技能石）" : "当前：精灵天然技能池"}
          >
            {showAllMoves ? "技能石 ✓" : "技能石"}
          </button>
        </div>
        {selectedMoves.length > 0 && (
          <div className="flex gap-1 flex-wrap mb-2">
            {selectedMoves.map((m) => {
              const isFromPool = movePool.some((pm) => pm.id === m.id);
              return (
                <span key={m.id} className={`text-xs px-1.5 py-0.5 rounded border ${
                  isFromPool
                    ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                    : "bg-amber-50 text-amber-700 border-amber-200"
                }`}>
                  {m.localized.zh.name}
                  {!isFromPool && <span className="text-amber-500 ml-0.5" title="技能石">⚡</span>}
                  <button onClick={() => onMovesChange(selectedMoves.filter((x) => x.id !== m.id))}
                    className="ml-0.5 text-indigo-400 hover:text-red-500">×</button>
                </span>
              );
            })}
          </div>
        )}
        {/* 随机技能快捷按钮（仅在技能不足4个时显示） */}
        {selectedMoves.length < 4 && (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-zinc-400">快捷:</span>
            {RANDOM_SKILL_IDS.map((rid) => {
              const rm = allMovesUnique.find(m => m.id === rid);
              if (!rm) return null;
              // 盲从（帅帅魔偶）：随机技能可重复携带
              const isBlindObey = monster?.trait?.localized?.zh?.name === "盲从";
              if (!isBlindObey && selectedMoves.some(m => m.id === rid)) return null;
              return (
                <button
                  key={`${rid}-${selectedMoves.filter(m => m.id === rid).length}`}
                  onClick={() => onMovesChange([...selectedMoves, rm])}
                  className="text-xs px-1.5 py-0.5 rounded border border-purple-200 bg-purple-50 text-purple-600 hover:bg-purple-100"
                  title={rm.localized.zh.description}
                >
                  +{rm.localized.zh.name}
                </button>
              );
            })}
          </div>
        )}
        <MoveSearch
          movePool={effectivePool}
          onSelect={(move) => {
            if (selectedMoves.length >= 4) return;
            // 盲从允许随机技能重复；其他技能仍去重
            const isBlindObey = monster?.trait?.localized?.zh?.name === "盲从";
            const isRandomSkill = RANDOM_SKILL_IDS.includes(move.id);
            const allowDup = isBlindObey && isRandomSkill;
            if (!allowDup && selectedMoves.some((m) => m.id === move.id)) return;
            onMovesChange([...selectedMoves, move]);
          }}
          excludeIds={(() => {
            const isBlindObey = monster?.trait?.localized?.zh?.name === "盲从";
            // 盲从下：不在 exclude 里排除随机技能（让它可重复出现）
            return isBlindObey
              ? selectedMoves.filter(m => !RANDOM_SKILL_IDS.includes(m.id)).map(m => m.id)
              : selectedMoves.map(m => m.id);
          })()}
        />
        {showAllMoves && (
          <p className="text-xs text-amber-500 mt-1">技能石模式：可添加全技能库中的任意技能。点击系别按钮筛选。</p>
        )}
      </div>
    </div>
  );
}

