import { useState, useMemo } from "react";
import type { Move, TypeInfo } from "../lib/types";
import typesData from "../data/types.json";
import { TYPE_COLORS, typeDotBg } from "../lib/typeColors";
import { matchSkillName } from "../lib/pinyinSearch";

const types = (typesData as TypeInfo[]).filter(t => t.name !== "Leader");

const CATEGORIES = [
  { value: "", label: "全部" },
  { value: "Physical Attack", label: "物攻" },
  { value: "Magic Attack", label: "魔攻" },
  { value: "Status", label: "状态" },
  { value: "Defense", label: "防御" },
] as const;

interface Props {
  movePool: Move[];
  onSelect: (move: Move) => void;
  excludeIds?: number[];
  defaultTypeFilter?: string;
}

export function MoveSearch({ movePool, onSelect, excludeIds = [], defaultTypeFilter }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [typeFilter, setTypeFilter] = useState(defaultTypeFilter || "");

  const filtered = useMemo(() => {
    let list = movePool;
    if (category) list = list.filter((m) => m.move_category === category);
    if (typeFilter) list = list.filter((m) => m.move_type?.name === typeFilter);
    if (query.trim()) {
      const q = query.trim();
      list = list.filter(
        (m) =>
          m.localized.zh.name.includes(q) ||
          m.name.toLowerCase().includes(q.toLowerCase()) ||
          (m.move_type?.localized.zh || "").includes(q) ||
          matchSkillName(m.localized.zh.name, q)
      );
    }
    // 按系别分组排列：同系别的技能聚在一起
    if (!typeFilter) {
      list = [...list].sort((a, b) => {
        const ta = a.move_type?.name || "￿";
        const tb = b.move_type?.name || "￿";
        if (ta !== tb) return ta.localeCompare(tb);
        return a.energy_cost - b.energy_cost || (a.power || 0) - (b.power || 0);
      });
    } else {
      list = [...list].sort((a, b) => a.energy_cost - b.energy_cost || (a.power || 0) - (b.power || 0));
    }
    return list;
  }, [movePool, query, category, typeFilter, excludeIds]);

  return (
    <div className="space-y-1.5">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索技能名称..."
        className="w-full text-xs px-2 py-1.5 border border-zinc-200 rounded-lg outline-none focus:border-indigo-300"
      />
      {/* 系别筛选 — 放在分类上面，因为更常用 */}
      <div className="flex gap-0.5 flex-wrap">
        {types.map((t) => (
          <button
            key={t.name}
            onClick={() => setTypeFilter(typeFilter === t.name ? "" : t.name)}
            className={`text-xs px-1.5 py-0.5 rounded-full transition-colors ${
              typeFilter === t.name
                ? `${typeDotBg(t.name)} font-medium`
                : "bg-zinc-50 text-zinc-400 hover:bg-zinc-100"
            }`}
          >
            {t.localized.zh}
          </button>
        ))}
      </div>
      <div className="flex gap-0.5 flex-wrap">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            onClick={() => setCategory(c.value)}
            className={`text-xs px-1.5 py-0.5 rounded ${
              category === c.value
                ? "bg-indigo-100 text-indigo-700 font-medium"
                : "text-zinc-500 hover:bg-zinc-100"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="max-h-48 overflow-y-auto space-y-0.5">
        {filtered.map((move) => (
          <button
            key={move.id}
            onClick={() => onSelect(move)}
            className="w-full text-left text-xs px-2 py-1 rounded flex items-center gap-1 hover:bg-zinc-50"
          >
            <span className={`px-1 rounded text-xs ${categoryColor(move.move_category)}`}>
              {categoryLabel(move.move_category)}
            </span>
            {move.move_type && (
              <span className={`text-xs px-1 rounded-full inline-flex items-center gap-0.5 ${typeDotBg(move.move_type.name)}`}>
                <span className={`w-1 h-1 rounded-full ${TYPE_COLORS[move.move_type.name]?.dot || "bg-zinc-400"}`} />
                {move.move_type.localized.zh}
              </span>
            )}
            <span className="flex-1 truncate">{move.localized.zh.name}：{move.localized.zh.description}</span>
            <span className="text-zinc-400">{move.energy_cost}费</span>
            {move.power && <span className="text-zinc-500">{move.power}威</span>}
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="text-xs text-zinc-400 text-center py-2">无匹配技能</p>
        )}
      </div>
    </div>
  );
}

function categoryLabel(cat: string) {
  if (cat === "Physical Attack") return "物攻";
  if (cat === "Magic Attack") return "魔攻";
  if (cat === "Status") return "状态";
  return "防御";
}

function categoryColor(cat: string) {
  if (cat === "Physical Attack") return "text-red-600 bg-red-50";
  if (cat === "Magic Attack") return "text-purple-600 bg-purple-50";
  if (cat === "Status") return "text-green-600 bg-green-50";
  return "text-blue-600 bg-blue-50";
}
