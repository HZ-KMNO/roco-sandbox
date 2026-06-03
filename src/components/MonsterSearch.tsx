import { useState, useMemo } from "react";
import type { Monster, TypeInfo } from "../lib/types";
import monstersData from "../data/monsters_list.json";
import monstersDetail from "../data/monsters_detail.json";
import typesData from "../data/types.json";
import { TYPE_COLORS, typeDotBg } from "../lib/typeColors";
import { matchMonsterName } from "../lib/pinyinSearch";

const monsters = monstersData as Monster[];
const detailMap = new Map((monstersDetail as Monster[]).map((m) => [m.id, m]));
const types = (typesData as TypeInfo[]).filter(t => t.name !== "Leader");

interface Props {
  onSelect: (monster: Monster) => void;
  label: string;
  excludeBaseNames?: string[];
  defaultTypeFilter?: string;
  nearbyDexNumber?: number;
}

export function MonsterSearch({ onSelect, label, excludeBaseNames: _excludeBaseNames, defaultTypeFilter, nearbyDexNumber }: Props) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState(defaultTypeFilter || "");

  const filtered = useMemo(() => {
    let list = typeFilter
      ? monsters.filter((m) => m.main_type.name === typeFilter || m.sub_type?.name === typeFilter)
      : monsters;
    // 排除首领化形态（只能通过进化之力变身，不可直接添加）
    list = list.filter((m) => !detailMap.get(m.id)?.is_leader_form);
    if (!query.trim()) {
      if (nearbyDexNumber != null) {
        return list
          .filter((m) => Math.abs(m.dex_number - nearbyDexNumber) <= 3)
          .sort((a, b) => a.dex_number - b.dex_number);
      }
      return list;
    }
    const q = query.trim();
    const qLower = q.toLowerCase();
    return list.filter(
      (m) =>
        m.localized.zh.name.includes(q) ||
        m.name.toLowerCase().includes(qLower) ||
        m.dex_number.toString() === q ||
        matchMonsterName(m.localized.zh.name, q)
    );
  }, [query, typeFilter, nearbyDexNumber]);

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-zinc-700 mb-1">
        {label}
      </label>
      <div className="flex gap-0.5 flex-wrap mb-1.5">
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
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索精灵名称或编号..."
        className="w-full text-sm px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
      />
      <ul className="mt-1 bg-white border border-zinc-200 rounded-lg shadow-sm max-h-52 overflow-y-auto">
        {filtered.map((m) => (
          <li
            key={m.id}
            onClick={() => { onSelect(m); setQuery(""); }}
            className="px-2 py-1 hover:bg-blue-50 cursor-pointer flex justify-between items-center border-b border-zinc-50 last:border-0"
            title={(() => { const d = detailMap.get(m.id); return d?.trait ? `${d.trait.localized.zh.name}：${d.trait.localized.zh.description}` : ""; })()}
          >
            <span>
              <span className="font-medium text-sm">{m.localized.zh.name}</span>
              <span className="text-zinc-400 text-sm ml-2">#{m.dex_number}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${typeDotBg(m.main_type.name)}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${TYPE_COLORS[m.main_type.name]?.dot || "bg-zinc-400"}`} />
                {m.main_type.localized.zh}
              </span>
              {m.sub_type && (
                <span className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${typeDotBg(m.sub_type.name)}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${TYPE_COLORS[m.sub_type.name]?.dot || "bg-zinc-400"}`} />
                  {m.sub_type.localized.zh}
                </span>
              )}
            </span>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-3 py-4 text-center text-sm text-zinc-400">无匹配精灵</li>
        )}
      </ul>
    </div>
  );
}
