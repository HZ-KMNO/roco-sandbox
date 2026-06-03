import { useState, useMemo } from "react";
import type { Monster, Move, TypeInfo } from "../lib/types";
import monstersList from "../data/monsters_list.json";
import monstersDetail from "../data/monsters_detail.json";
import evolutionData from "../data/evolution_chains.json";
import typesData from "../data/types.json";
import { TYPE_COLORS, typeDotBg } from "../lib/typeColors";
import { matchMonsterName } from "../lib/pinyinSearch";
import { getPopularPersonality, getPopularTalent, formatPersonality } from "../lib/popularStats";
import popularMovesData from "../data/popular_moves.json";
import allMovesData from "../data/moves.json";

const monsters = (monstersList as Monster[]).sort((a, b) => a.dex_number - b.dex_number);
const detailMap = new Map((monstersDetail as Monster[]).map((m) => [m.id, m]));
const types = (typesData as TypeInfo[]).filter(t => t.name !== "Leader");
const popularMoves = popularMovesData as Record<string, number[]>;
const allMoves = allMovesData as Move[];
const TALENT_LABELS: Record<string, string> = { hp: "生命", hp_boost: "生命", physicalAttack: "物攻", phy_atk_boost: "物攻", magicalAttack: "魔攻", mag_atk_boost: "魔攻", physicalDefense: "物防", phy_def_boost: "物防", magicalDefense: "魔防", mag_def_boost: "魔防", speed: "速度", spd_boost: "速度" };

export function Pokedex() {
  const [query, setQuery] = useState("");
  const [typeFilters, setTypeFilters] = useState<string[]>([]);
  const [selected, setSelected] = useState<Monster | null>(() => monsters.find(m => m.id === 1) || null);

  const toggleType = (t: string) => {
    setTypeFilters(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  };

  const filtered = useMemo(() => {
    let list = typeFilters.length > 0
      ? monsters.filter(m => typeFilters.some(t => m.main_type.name === t || m.sub_type?.name === t))
      : monsters;
    if (query.trim()) {
      const q = query.trim();
      const qLower = q.toLowerCase();
      list = list.filter(
        (m) => {
          // Name/dex/pinyin match
          if (m.localized.zh.name.includes(q) || m.name.toLowerCase().includes(qLower) || String(m.dex_number) === q || matchMonsterName(m.localized.zh.name, q)) return true;
          // Skill match: check if any move name contains query
          const detail = detailMap.get(m.id);
          if (detail?.move_pool) {
            return detail.move_pool.some(mv => mv.localized.zh.name.includes(q) || mv.name.toLowerCase().includes(qLower));
          }
          return false;
        }
      );
    }
    return list;
  }, [query, typeFilters]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-xl border border-zinc-200 p-3 shadow-sm">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜精灵名/编号/技能名..."
          className="w-full text-sm px-3 py-2 border border-zinc-200 rounded-lg outline-none focus:border-indigo-300 mb-2"
        />
        <div className="flex gap-0.5 flex-wrap">
          {types.map((t) => (
            <button
              key={t.name}
              onClick={() => toggleType(t.name)}
              className={`text-xs px-1.5 py-0.5 rounded-full transition-colors ${
                typeFilters.includes(t.name)
                  ? `${typeDotBg(t.name)} font-medium`
                  : "bg-zinc-50 text-zinc-400 hover:bg-zinc-100"
              }`}
            >
              {t.localized.zh}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-4">
        {/* Monster list */}
        <div className="w-72 shrink-0 bg-white rounded-xl border border-zinc-200 shadow-sm max-h-[70vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-sm text-zinc-400 text-center py-8">无匹配精灵</p>
          ) : (
            filtered.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelected(m)}
                title={(() => { const td = detailMap.get(m.id); return td?.trait ? `${td.trait.localized.zh.name}：${td.trait.localized.zh.description}` : ""; })()}
                className={`w-full text-left text-xs px-2 py-1 flex items-center justify-between hover:bg-zinc-50 border-b border-zinc-50 ${
                  selected?.id === m.id ? "bg-indigo-50 border-l-2 border-l-indigo-400" : ""
                }`}
              >
                <span>
                  {getPopularPersonality(m.id) && <span className="text-amber-500 mr-0.5" title="有推荐配置">⭐</span>}
                  <span className="font-medium text-zinc-800">
                    {m.localized.zh.name}
                  </span>
                  <span className="text-zinc-400 ml-1.5">#{m.dex_number}</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className={`text-xs px-1.5 py-0.5 rounded-full inline-flex items-center gap-1 ${typeDotBg(m.main_type.name)}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${TYPE_COLORS[m.main_type.name]?.dot || "bg-zinc-400"}`} />
                    {m.main_type.localized.zh}
                  </span>
                  {m.sub_type && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full inline-flex items-center gap-1 ${typeDotBg(m.sub_type.name)}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${TYPE_COLORS[m.sub_type.name]?.dot || "bg-zinc-400"}`} />
                      {m.sub_type.localized.zh}
                    </span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Detail panel */}
        <div className="flex-1 min-w-0 max-h-[70vh] overflow-y-auto bg-white rounded-xl border border-zinc-200 shadow-sm">
          {selected ? (
            <MonsterDetail monster={selected} />
          ) : (
            <div className="p-8 text-center">
              <p className="text-sm text-zinc-400">选择一只精灵查看详情</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MonsterDetail({ monster }: { monster: Monster }) {
  const detail = detailMap.get(monster.id);
  const d = detail || monster;

  // Build evolution chain
  const buildChain = (): Monster[] => {
    const chain: Monster[] = [];
    const visited = new Set<number>();
    // Walk backwards to find the base form
    let current: Monster | undefined = d;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      chain.unshift(current);
      // prevMap: current id → previous evolution id
      const prevId = (evolutionData.prevMap as Record<string, number>)[String(current.id)];
      if (prevId) current = detailMap.get(prevId);
      else current = undefined;
    }
    // Walk forward from the current's final form
    const finalId = (evolutionData.finalMap as Record<string, number>)[String(d.id)];
    if (finalId && finalId !== d.id) {
      let next = detailMap.get(finalId);
      while (next && !visited.has(next.id)) {
        visited.add(next.id);
        chain.push(next);
        const nextFinal = (evolutionData.finalMap as Record<string, number>)[String(next.id)];
        next = nextFinal && nextFinal !== next.id ? detailMap.get(nextFinal) : undefined;
      }
    }
    // Append leader form if exists
    const leaderForm = (monstersDetail as Monster[]).find(m =>
      m.dex_number === d.dex_number && m.leader_potential && m.id !== d.id
    );
    if (leaderForm && !visited.has(leaderForm.id)) chain.push(leaderForm);
    return chain;
  };
  const evoChain = buildChain();

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-bold text-zinc-900" title={d.trait ? `${d.trait.localized.zh.name}：${d.trait.localized.zh.description}` : ""}>
            {d.localized.zh.name}
          </h2>
          <p className="text-sm text-zinc-500">
            #{d.dex_number} {d.name}
            {d.leader_potential && <span className="ml-1 text-amber-500 font-medium">首领</span>}
            {d.form && (
              <span className="ml-1 text-zinc-400">({d.form})</span>
            )}
          </p>
        </div>
        <div className="flex gap-1">
          <span className={`text-xs px-2 py-1 rounded-full inline-flex items-center gap-1 ${typeDotBg(d.main_type.name)}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${TYPE_COLORS[d.main_type.name]?.dot || "bg-zinc-400"}`} />
            {d.main_type.localized.zh}
          </span>
          {d.sub_type && (
            <span className={`text-xs px-2 py-1 rounded-full inline-flex items-center gap-1 ${typeDotBg(d.sub_type.name)}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${TYPE_COLORS[d.sub_type.name]?.dot || "bg-zinc-400"}`} />
              {d.sub_type.localized.zh}
            </span>
          )}
        </div>
      </div>

      {/* Evolution chain */}
      {evoChain.length > 1 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs text-zinc-500 mr-1">进化链：</span>
          {evoChain.map((em, i) => (
            <span key={em.id} className="flex items-center gap-1">
              {i > 0 && <span className="text-zinc-300">→</span>}
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                em.id === d.id ? "bg-indigo-100 text-indigo-700 font-medium" : "bg-zinc-100 text-zinc-600"
              } ${em.leader_potential ? "border border-amber-300" : ""}`}>
                {em.localized.zh.name}
                {em.leader_potential && <span className="text-amber-500 ml-0.5">👑</span>}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Base stats */}
      <div>
        <h4 className="text-sm font-medium text-zinc-700 mb-2">种族值</h4>
        <div className="grid grid-cols-3 gap-2">
          <StatBar label="生命" value={d.base_hp} color="bg-green-400" />
          <StatBar label="物攻" value={d.base_phy_atk} color="bg-red-400" />
          <StatBar label="魔攻" value={d.base_mag_atk} color="bg-purple-400" />
          <StatBar label="物防" value={d.base_phy_def} color="bg-amber-400" />
          <StatBar label="魔防" value={d.base_mag_def} color="bg-blue-400" />
          <StatBar label="速度" value={d.base_spd} color="bg-cyan-400" />
        </div>
        <div className="mt-1 text-xs text-zinc-400 text-right">
          合计 {d.base_hp + d.base_phy_atk + d.base_mag_atk + d.base_phy_def + d.base_mag_def + d.base_spd}
        </div>
      </div>

      {/* 推荐配置 */}
      {getPopularPersonality(monster.id) && (
        <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-3">
          <h4 className="text-sm font-medium text-amber-800 mb-2">⭐ 推荐配置</h4>
          <div className="space-y-1.5 text-xs">
            {(() => {
              const pers = getPopularPersonality(monster.id);
              const tal = getPopularTalent(monster.id);
              const moves = popularMoves[String(monster.id)];
              return <>
                {pers && <p><span className="text-zinc-500">性格：</span><span className="font-medium text-zinc-800">{formatPersonality(pers)}</span></p>}
                {tal && <p><span className="text-zinc-500">个体：</span><span className="font-medium text-zinc-800">{Object.entries(tal).filter(([,v])=>v>0).map(([k])=>TALENT_LABELS[k]||k).join("、")}</span></p>}
                {moves && moves.length > 0 && (
                  <div>
                    <span className="text-zinc-500">配招：</span>
                    <span className="font-medium text-zinc-800">
                      {moves.map((mid: number) => {
                        const mv = d.move_pool?.find(m => m.id === mid) || allMoves.find(m => m.id === mid);
                        return mv ? mv.localized.zh.name : `#${mid}`;
                      }).join(" / ")}
                    </span>
                  </div>
                )}
              </>;
            })()}
          </div>
        </div>
      )}

      {/* Trait */}
      {d.trait && (
        <div>
          <h4 className="text-sm font-medium text-zinc-700 mb-1">血脉</h4>
          <p className="text-sm text-zinc-800 font-medium">{d.trait.localized.zh.name}</p>
          <p className="text-xs text-zinc-500">{d.trait.localized.zh.description}</p>
        </div>
      )}

      {/* Move pool */}
      {d.move_pool && d.move_pool.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-zinc-700 mb-2">
            技能池 ({d.move_pool.length})
          </h4>
          <div className="grid grid-cols-2 gap-1">
            {d.move_pool.map((move) => (
              <div
                key={move.id}
                className="text-xs px-2 py-1 rounded flex items-center gap-1.5 bg-zinc-50"
              >
                <span className="font-medium text-zinc-700 truncate">
                  {move.localized.zh.name}
                </span>
                {move.move_type && (
                  <span className={`text-xs px-1 rounded-full inline-flex items-center gap-0.5 ${typeDotBg(move.move_type.name)}`}>
                    <span className={`w-1 h-1 rounded-full ${TYPE_COLORS[move.move_type.name]?.dot || "bg-zinc-400"}`} />
                    {move.move_type.localized.zh}
                  </span>
                )}
                <span className="text-xs text-zinc-400 ml-auto">
                  {move.energy_cost}费
                  {move.power && ` ${move.power}威`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.min((value / 200) * 100, 100);
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-xs">
        <span className="text-zinc-500">{label}</span>
        <span className="font-mono text-zinc-700">{value}</span>
      </div>
      <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
