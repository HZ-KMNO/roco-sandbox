import { useState, useMemo } from "react";
import type { Monster } from "../lib/types";
import { MonsterSearch } from "./MonsterSearch";
import { QuickImport } from "./QuickImport";
import { predictTeammates } from "../lib/teamPrediction";
import { TYPE_COLORS, typeDotBg } from "../lib/typeColors";
import { getPopularPersonality, getPopularTalent, formatPersonality } from "../lib/popularStats";
import monstersDetail from "../data/monsters_detail.json";

const TALENT_LABELS: Record<string, string> = { hp_boost: "生命", phy_atk_boost: "物攻", mag_atk_boost: "魔攻", phy_def_boost: "物防", mag_def_boost: "魔防", spd_boost: "速度" };
const detailMap = new Map((monstersDetail as Monster[]).map((m) => [m.id, m]));

interface Props {
  team: Monster[];
  onTeamChange: (team: Monster[]) => void;
  activeIndex: number;
  onActiveChange: (index: number) => void;
  rankMode: "below_master" | "master_plus";
}

export function EnemyPanel({ team, onTeamChange, activeIndex, onActiveChange, rankMode }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(activeIndex);
  const active = team[selectedIndex] ?? null;

  const teamBaseNames = useMemo(() => team.map((m) => {
    const idx = m.localized.zh.name.indexOf("（");
    return idx === -1 ? m.localized.zh.name : m.localized.zh.name.slice(0, idx);
  }), [team]);

  const addMember = (monster: Monster) => {
    if (team.length >= 6) return;
    const newTeam = [...team, monster];
    onTeamChange(newTeam);
    onActiveChange(newTeam.length - 1);
    setSelectedIndex(newTeam.length - 1);
  };

  const removeMember = (index: number) => {
    const newTeam = team.filter((_, i) => i !== index);
    onTeamChange(newTeam);
    if (activeIndex >= newTeam.length) {
      onActiveChange(Math.max(0, newTeam.length - 1));
    } else if (activeIndex > index) {
      onActiveChange(activeIndex - 1);
    }
  };

  const teammatePredictions = useMemo(() => {
    if (team.length === 0) return [];
    return predictTeammates(team.map((m) => m.id), teamBaseNames);
  }, [team, teamBaseNames]);

  return (
    <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-2">
      <div className="flex items-center justify-between mb-1 shrink-0">
        <label className="block text-sm font-semibold text-zinc-800">对方队伍</label>
        <div className="flex items-center gap-1 flex-wrap justify-end">
          <QuickImport label="敌方" onImport={(monsters) => {
            const existingIds = new Set(team.map((m) => m.id));
            const newMonsters = monsters.filter((m) => !existingIds.has(m.id));
            if (newMonsters.length > 0) {
              onTeamChange([...team, ...newMonsters].slice(0, 6));
            }
          }} />
          {team.length > 0 && (
            <button
              onClick={() => { onTeamChange([]); onActiveChange(0); }}
              className="text-xs px-2 py-0.5 rounded border border-dashed border-red-200 text-red-400 hover:border-red-400 hover:text-red-600"
            >
              清空
            </button>
          )}
        </div>
      </div>
      <div className="flex gap-1 mb-1.5 flex-wrap">
        {team.map((monster, i) => (
          <button
            key={i}
            onClick={() => setSelectedIndex(i)}
            onDoubleClick={(e) => { e.preventDefault(); onActiveChange(i); setSelectedIndex(i); }}
            className={`relative text-xs px-2 py-1 rounded border transition-colors ${
              i === selectedIndex
                ? "bg-red-50 border-red-300 text-red-700 font-medium"
                : "bg-white border-zinc-200 text-zinc-600 hover:border-red-200"
            }`}
            title={(() => { const d = detailMap.get(monster.id); return d?.trait ? `${d.trait.localized.zh.name}：${d.trait.localized.zh.description}` : "双击设为首发"; })()}
          >
            {i === activeIndex && <span className="text-xs text-amber-500 mr-0.5">⭐</span>}
            {monster.localized.zh.name}
            <span
              onClick={(e) => { e.stopPropagation(); removeMember(i); }}
              className="ml-1.5 text-zinc-400 hover:text-red-500"
            >
              ×
            </span>
          </button>
        ))}
        {rankMode === "below_master" && team.length < 6 && (
          Array.from({ length: 6 - team.length }).map((_, i) => (
            <span key={`unknown-${i}`} className="text-xs px-2 py-1 rounded border border-dashed border-zinc-200 text-zinc-300">
              ?
            </span>
          ))
        )}
      </div>

      {team.length < 6 && (
        <div className="mb-1.5">
          <MonsterSearch label="添加对方精灵" onSelect={addMember} excludeBaseNames={teamBaseNames} />
        </div>
      )}

      {teammatePredictions.length > 0 && team.length < 6 && (
        <div className="mb-1.5">
          <p className="text-xs text-zinc-400 mb-1">可能队友</p>
          <div className="flex gap-1 flex-wrap">
            {teammatePredictions.map(({ monster, score }) => (
              <button key={monster.id}
                onClick={() => addMember(monster)}
                className="text-xs px-2 py-0.5 rounded border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100"
                title={(() => { const d = detailMap.get(monster.id); return d?.trait ? `${d.trait.localized.zh.name}：${d.trait.localized.zh.description}` : ""; })()}>
                {monster.localized.zh.name} ×{score}
              </button>
            ))}
          </div>
        </div>
      )}

      {active && (
        <div className="bg-white rounded-lg border border-zinc-200 p-2.5 shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-sm font-bold text-zinc-900" title={(() => { const d = detailMap.get(active.id); return d?.trait ? `${d.trait.localized.zh.name}：${d.trait.localized.zh.description}` : ""; })()}>
                {active.localized.zh.name}
              </h3>
              <p className="text-xs text-zinc-400">
                #{active.dex_number}
              </p>
            </div>
            <div className="flex gap-1">
              <span className={`text-xs px-2 py-1 rounded-full inline-flex items-center gap-1 ${typeDotBg(active.main_type.name)}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${TYPE_COLORS[active.main_type.name]?.dot || "bg-zinc-400"}`} />
                {active.main_type.localized.zh}
              </span>
              {active.sub_type && (
                <span className={`text-xs px-2 py-1 rounded-full inline-flex items-center gap-1 ${typeDotBg(active.sub_type.name)}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${TYPE_COLORS[active.sub_type.name]?.dot || "bg-zinc-400"}`} />
                  {active.sub_type.localized.zh}
                </span>
              )}
            </div>
          </div>
          <p className="text-xs text-zinc-400 mt-2">
            {(() => {
              const pers = getPopularPersonality(active.id);
              const tal = getPopularTalent(active.id);
              if (!pers) return "性格/个体值：热门配置暂无数据";
              const boosts = Object.entries(tal).filter(([,v]) => v > 0).map(([k]) => TALENT_LABELS[k]).join("、");
              return `${formatPersonality(pers)} · 个体值：${boosts || "无"}`;
            })()}
          </p>
        </div>
      )}

    </div>
  );
}
