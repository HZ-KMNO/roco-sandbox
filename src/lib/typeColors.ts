// 19 系别统一配色（背景 + 文字 + 圆点色）
export const TYPE_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  Normal:     { bg: "bg-zinc-100",   text: "text-zinc-600",   dot: "bg-zinc-400" },
  Grass:      { bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-500" },
  Fire:       { bg: "bg-red-100",    text: "text-red-700",    dot: "bg-red-500" },
  Water:      { bg: "bg-blue-100",   text: "text-blue-700",   dot: "bg-blue-500" },
  Light:      { bg: "bg-sky-100",    text: "text-sky-700",    dot: "bg-sky-400" },
  Ground:     { bg: "bg-yellow-100", text: "text-yellow-700", dot: "bg-yellow-500" },
  Ice:        { bg: "bg-cyan-100",   text: "text-cyan-700",   dot: "bg-cyan-500" },
  Dragon:     { bg: "bg-rose-100",   text: "text-rose-700",   dot: "bg-rose-500" },
  Electric:   { bg: "bg-yellow-100", text: "text-yellow-800", dot: "bg-yellow-400" },
  Poison:     { bg: "bg-purple-100", text: "text-purple-700", dot: "bg-purple-500" },
  Bug:        { bg: "bg-lime-100",   text: "text-lime-700",   dot: "bg-lime-500" },
  Fighting:   { bg: "bg-orange-100", text: "text-orange-700", dot: "bg-orange-500" },
  Flying:     { bg: "bg-sky-100",    text: "text-sky-700",    dot: "bg-sky-500" },
  Cute:       { bg: "bg-pink-100",   text: "text-pink-700",   dot: "bg-pink-400" },
  Ghost:      { bg: "bg-violet-100", text: "text-violet-700", dot: "bg-violet-500" },
  Dark:       { bg: "bg-stone-700",  text: "text-stone-100",  dot: "bg-stone-400" },
  Mechanical: { bg: "bg-slate-200",  text: "text-slate-700",  dot: "bg-slate-500" },
  Illusion:   { bg: "bg-fuchsia-100",text: "text-fuchsia-700",dot: "bg-fuchsia-500" },
  Leader:     { bg: "bg-indigo-100", text: "text-indigo-700", dot: "bg-indigo-500" },
};

/** 系别中文名 */
export const TYPE_ZH: Record<string, string> = {
  Normal: "普通", Grass: "草", Fire: "火", Water: "水", Light: "光",
  Ground: "地", Ice: "冰", Dragon: "龙", Electric: "电", Poison: "毒",
  Bug: "虫", Fighting: "武", Flying: "翼", Cute: "萌", Ghost: "幽",
  Dark: "恶", Mechanical: "机械", Illusion: "幻", Leader: "首领",
};

/**
 * 彩色圆点 + 系别名称
 * 例: ● 草  ● 火  ● 水
 */
export function typeDotBg(name: string): string {
  const c = TYPE_COLORS[name];
  return c ? `${c.bg} ${c.text}` : "bg-zinc-100 text-zinc-600";
}
