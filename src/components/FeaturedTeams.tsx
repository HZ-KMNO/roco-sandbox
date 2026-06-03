import { useState, useEffect, useMemo } from "react";
import type { Monster, Move, Personality, TypeInfo } from "../lib/types";
import type { TeamMember } from "./TeamPanel";
import { convertBuild } from "../lib/buildConverter";
import { getCachedTeams, fetchPopularTeams } from "../lib/fetcher";
import { Icon } from "./Icon";
import { TYPE_COLORS, typeDotBg } from "../lib/typeColors";
import { matchMonsterName } from "../lib/pinyinSearch";
import { parseOfficialTeamLine } from "../lib/officialFormatParser";
import bundledData from "../data/popular_teams.json";
import typesData from "../data/types.json";
import monstersDetail from "../data/monsters_detail.json";
import allMoves from "../data/moves.json";
import personalitiesData from "../data/personalities.json";

const detailMap = new Map((monstersDetail as Monster[]).map(m => [m.id, m]));
const PERSONALITIES = personalitiesData as Personality[];

const allTypes = (typesData as TypeInfo[]).filter(t => t.name !== "Leader");

interface TeamSnapshot {
  team: { name: string };
  builds: Array<{
    creatureId: string;
    statMarks: { extremeStat: string; plusStats: string[]; minusStat: string };
    selectedSkillNames: string[];
  }>;
}
interface TeamItem { id: string; snapshot: TeamSnapshot; likeCount?: number }
interface PopularTeamsJson { items: TeamItem[] }
interface SavedTemplate { id: string; name: string; members: TeamMember[] }

interface Props {
  onImportMyTeam: (members: TeamMember[]) => void;
  onImportEnemyTeam: (monsters: Monster[]) => void;
}

export function FeaturedTeams({ onImportMyTeam, onImportEnemyTeam }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [teamsData, setTeamsData] = useState<PopularTeamsJson>(bundledData as unknown as PopularTeamsJson);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [usingCache, setUsingCache] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [templates, setTemplates] = useState<SavedTemplate[]>(() => {
    try { return JSON.parse(localStorage.getItem("roco_team_templates") || "[]"); } catch { return []; }
  });
  const [showTemplates, setShowTemplates] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");

  useEffect(() => {
    getCachedTeams().then((text) => {
      if (text) {
        try { const data = JSON.parse(text) as PopularTeamsJson; if (data.items?.length > 0) { setTeamsData(data); setUsingCache(true); } } catch {}
      }
    });
  }, []);

  useEffect(() => {
    localStorage.setItem("roco_team_templates", JSON.stringify(templates));
  }, [templates]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const text = await fetchPopularTeams();
      const data = JSON.parse(text) as PopularTeamsJson;
      if (data.items?.length > 0) { setTeamsData(data); setUsingCache(true); }
      setLastUpdate(new Date().toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
    } catch {
      if (!usingCache) alert("拉取失败：请在 Tauri 桌面应用中运行此功能");
    } finally { setRefreshing(false); }
  };

  // Filter teams
  const filteredTeams = useMemo(() => {
    let list = teamsData.items;
    if (search.trim()) {
      const raw = search.trim();
      const q = raw.toLowerCase();
      list = list.filter(item => {
        const teamName = item.snapshot.team.name;
        // 队伍名直匹（包含 + 拼音首字母）
        if (teamName.toLowerCase().includes(q) || matchMonsterName(teamName, raw)) return true;
        const builds = item.snapshot.builds.map(b => convertBuild(b));
        return builds.some(b => {
          const name = b.monster?.localized.zh.name || "";
          return name.toLowerCase().includes(q) || matchMonsterName(name, raw);
        });
      });
    }
    if (typeFilter) {
      list = list.filter(item => {
        const builds = item.snapshot.builds.map(b => convertBuild(b));
        return builds.some(b => b.monster?.main_type.name === typeFilter || b.monster?.sub_type?.name === typeFilter);
      });
    }
    return list;
  }, [teamsData, search, typeFilter]);

  // Save current team as template
  const saveTemplate = (name: string, members: TeamMember[]) => {
    const id = Date.now().toString(36);
    setTemplates(prev => [...prev, { id, name, members }]);
  };

  const deleteTemplate = (id: string) => {
    setTemplates(prev => prev.filter(t => t.id !== id));
  };

  // 解析官方分享格式（# 注释行，委托共享 lib）
  const parseOfficialComment = (line: string): TeamMember | null => {
    const parsed = parseOfficialTeamLine(line);
    if (!parsed) return null;
    return {
      monster: parsed.monster,
      personality: parsed.personality || PERSONALITIES[0],
      talent: parsed.talent,
      selectedMoves: parsed.selectedMoves,
      bloodline: parsed.bloodline,
    };
  };

  const handleImport = () => {
    setImportError("");
    if (!importText.trim()) return;
    const lines = importText.trim().split(/\n+/);
    const members: TeamMember[] = [];

    // 优先尝试官方注释格式
    const failedNames: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("#")) continue;
      // 仅当格式确实是 "# 名字：xx血脉、{...}" 才尝试
      if (!/[：:].*血脉/.test(trimmed)) continue;
      const member = parseOfficialComment(trimmed);
      if (member) {
        members.push(member);
      } else {
        const m = trimmed.match(/^#\s*([^：:]+)/);
        if (m) failedNames.push(m[1].trim());
      }
    }

    // 没匹配到官方注释 → fallback 到简易格式
    if (members.length === 0) {
      const simpleLines = importText.trim().split(/[\n||]+/);
      for (const line of simpleLines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("###")) continue;
        const parts = trimmed.split("//");
        if (parts.length < 3) continue;
        const namePart = parts[0];
        const name = namePart.split("#")[0].trim();
        const persName = parts[1].trim();
        const rest = parts.slice(2).join("//");
        let monster: Monster | undefined;
        for (const m of (monstersDetail as Monster[])) {
          if (m.localized.zh.name === name) { monster = m; break; }
        }
        if (!monster) {
          for (const m of (monstersDetail as Monster[])) {
            if (m.localized.zh.name.includes(name)) { monster = m; break; }
          }
        }
        if (!monster) { setImportError(`未找到精灵: ${name}`); return; }
        const personality = PERSONALITIES.find(p => p.localized.zh === persName) || PERSONALITIES[0];
        const talent = { hp_boost: 0, phy_atk_boost: 0, mag_atk_boost: 0, phy_def_boost: 0, mag_def_boost: 0, spd_boost: 0 };
        const talentKeys: Record<string, keyof typeof talent> = {
          "生命": "hp_boost", "物攻": "phy_atk_boost", "魔攻": "mag_atk_boost",
          "物防": "phy_def_boost", "魔防": "mag_def_boost", "速度": "spd_boost",
        };
        const detail = detailMap.get(monster.id);
        const pool = detail?.move_pool || [];
        const selectedMoves: Move[] = [];
        let talentStr = rest;
        for (const [k, v] of Object.entries(talentKeys)) {
          if (talentStr.includes(k)) {
            talent[v] = 10;
            talentStr = talentStr.replace(k, "");
          }
        }
        const words = talentStr.split(/[/\\s]+/).filter(w => w);
        for (const w of words) {
          const mv = pool.find(m => m.localized.zh.name === w) || (allMoves as Move[]).find(m => m.localized.zh.name === w);
          if (mv && !selectedMoves.some(s => s.id === mv.id) && selectedMoves.length < 4) {
            selectedMoves.push(mv);
          }
        }
        members.push({ monster, personality, talent, selectedMoves, bloodline: null });
      }
    }

    if (members.length === 0) {
      setImportError("未识别到任何精灵。支持官方分享格式（# 海豹船长：武系血脉、{...}）或简易格式");
      return;
    }
    if (failedNames.length > 0) {
      setImportError(`已导入 ${members.length} 只，但未识别：${failedNames.join("、")}`);
    }
    const name = `导入配队 ${new Date().toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
    const id = Date.now().toString(36);
    setTemplates(prev => [{ id, name, members }, ...prev]);
    setImportText("");
    setShowImport(false);
    setShowTemplates(true);
  };

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-3 shadow-sm space-y-2 max-h-[75vh] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-zinc-700">
            热门配队 ({teamsData.items.length})
          </h3>
          {usingCache && <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">在线</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowImport(!showImport)}
            className="text-xs px-2 py-1 rounded border border-dashed border-zinc-300 text-zinc-500 hover:border-indigo-300 hover:text-indigo-500"
          >导入</button>
          <button onClick={() => setShowTemplates(!showTemplates)}
            className={`text-xs px-2 py-1 rounded border transition-colors ${
              showTemplates ? "bg-indigo-50 border-indigo-200 text-indigo-600" : "border-zinc-200 text-zinc-500 hover:border-zinc-300"
            }`}
          >我的模板 ({templates.length})</button>
          {lastUpdate && <span className="text-xs text-zinc-400">{lastUpdate}</span>}
          <button onClick={handleRefresh} disabled={refreshing}
            className="text-xs px-2 py-1 rounded border border-zinc-200 text-zinc-500 hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-50"
          ><Icon name="refresh" size={13} className={refreshing ? "animate-spin" : ""} /> {refreshing ? "刷新中..." : "刷新"}</button>
        </div>
      </div>

      {/* Import modal */}
      {showImport && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 shrink-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-amber-700">导入配队</span>
            <button onClick={() => { setShowImport(false); setImportText(""); setImportError(""); }} className="text-xs text-amber-400 hover:text-amber-600">×</button>
          </div>
          <p className="text-xs text-amber-500 mb-1.5">格式：精灵名#编号//性格//个体值技能1/技能2/技能3/技能4（多只精灵换行）</p>
          <textarea value={importText} onChange={e => setImportText(e.target.value)}
            placeholder="迪莫#1//固执//生命物攻速度光球/魔法增效/棘突/火焰箭&#10;恶魔狼#131//开朗//物攻速度防御暗袭/恶之波动/防御/聚能"
            className="w-full text-xs p-2 border border-amber-200 rounded-lg resize-none h-24 outline-none focus:border-amber-300"
          />
          {importError && <p className="text-xs text-red-500 mt-1">{importError}</p>}
          <button onClick={handleImport} disabled={!importText.trim()}
            className="w-full mt-1.5 text-xs px-3 py-1.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50"
          >导入</button>
        </div>
      )}

      {/* Search + filter */}
      <div className="flex gap-2 shrink-0">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="搜索队伍名或精灵名..." className="flex-1 text-xs px-2.5 py-1.5 border border-zinc-200 rounded-lg outline-none focus:border-indigo-300" />
        <div className="flex gap-0.5 flex-wrap">
          <button onClick={() => setTypeFilter("")}
            className={`text-xs px-1.5 py-1 rounded ${!typeFilter ? "bg-indigo-100 text-indigo-700 font-medium" : "bg-zinc-50 text-zinc-400 hover:bg-zinc-100"}`}>全部</button>
          {allTypes.slice(0, 9).map(t => (
            <button key={t.name} onClick={() => setTypeFilter(typeFilter === t.name ? "" : t.name)}
              className={`text-xs px-1.5 py-1 rounded transition-colors ${typeFilter === t.name ? `${typeDotBg(t.name)} font-medium` : "bg-zinc-50 text-zinc-400 hover:bg-zinc-100"}`}
            >{t.localized.zh}</button>
          ))}
        </div>
      </div>

      {/* Content: templates or teams */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-1">
        {showTemplates ? (
          templates.length === 0 ? (
            <p className="text-xs text-zinc-400 text-center py-4">暂无保存的模板</p>
          ) : (
            templates.map(t => (
              <div key={t.id} className="border border-zinc-200 rounded-lg">
                <button onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                  className="w-full text-left text-xs px-2.5 py-2 flex items-center justify-between hover:bg-zinc-50 rounded-lg"
                ><span className="font-medium text-zinc-800">{t.name}</span><span className="text-zinc-400">{t.members.length}只</span></button>
                {expandedId === t.id && (
                  <div className="px-2.5 pb-2 space-y-1.5">
                    {t.members.map((m, i) => (
                      <div key={i} className="text-xs text-zinc-600 flex items-center justify-between border-t border-zinc-50 pt-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-zinc-800">{m.monster.localized.zh.name}</span>
                          <span className="text-zinc-400">{m.personality?.localized.zh || "平衡"}</span>
                        </div>
                        <span className="text-zinc-400">{m.selectedMoves.map(mv => mv.localized.zh.name).join(" / ")}</span>
                      </div>
                    ))}
                    <div className="flex gap-2 pt-1.5 border-t border-zinc-100">
                      <button onClick={() => onImportMyTeam(t.members)} className="flex-1 text-xs py-1 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100">导入我方</button>
                      <button onClick={() => onImportEnemyTeam(t.members.map(m => m.monster))} className="flex-1 text-xs py-1 rounded bg-red-50 text-red-600 hover:bg-red-100">导入敌方</button>
                      <button onClick={() => deleteTemplate(t.id)} className="text-xs px-2 py-1 rounded bg-zinc-50 text-zinc-400 hover:text-red-500">删除</button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )
        ) : (
          filteredTeams.length === 0 ? (
            <p className="text-xs text-zinc-400 text-center py-4">无匹配队伍</p>
          ) : (
            filteredTeams.map((item) => {
              const expanded = expandedId === item.id;
              const builds = item.snapshot.builds.map(b => convertBuild(b));
              const validBuilds = builds.filter(b => b.monster !== null);
              const members: TeamMember[] = validBuilds.map(b => ({
                monster: b.monster!, personality: b.personality, talent: b.talent, selectedMoves: b.moves, bloodline: null,
              }));

              return (
                <div key={item.id} className="border border-zinc-200 rounded-lg">
                  <button onClick={() => setExpandedId(expanded ? null : item.id)}
                    className="w-full text-left text-xs px-2.5 py-2 flex items-center justify-between hover:bg-zinc-50 rounded-lg"
                  >
                    <span className="font-medium text-zinc-800">{item.snapshot.team.name}</span>
                    <div className="flex items-center gap-1.5">
                      {builds.filter(b => b.monster).slice(0, 6).map((b, i) => (
                        b.monster && <span key={i} className={`w-1.5 h-1.5 rounded-full ${TYPE_COLORS[b.monster.main_type.name]?.dot || "bg-zinc-400"}`} title={b.monster.main_type.localized.zh} />
                      ))}
                      <span className="text-zinc-400 ml-1">{validBuilds.length}只</span>
                      {item.likeCount ? <span className="text-zinc-300">♥{item.likeCount}</span> : null}
                    </div>
                  </button>
                  {expanded && (
                    <div className="px-2.5 pb-2 space-y-1.5">
                      {builds.map((b, i) => (
                        <div key={i} className="text-xs text-zinc-600 flex items-center justify-between border-t border-zinc-50 pt-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${b.monster ? TYPE_COLORS[b.monster.main_type.name]?.dot || "bg-zinc-400" : "bg-zinc-300"}`} />
                            <span className="font-medium text-zinc-800">{b.monster ? b.monster.localized.zh.name : `#${item.snapshot.builds[i].creatureId}`}</span>
                            <span className="text-zinc-400">{b.personality.localized.zh}</span>
                          </div>
                          <span className="text-zinc-400">{b.moves.map((m: Move) => m.localized.zh.name).join(" / ")}</span>
                        </div>
                      ))}
                      <div className="flex gap-2 pt-1.5 border-t border-zinc-100">
                        <button onClick={() => onImportMyTeam(members)} className="flex-1 text-xs py-1 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100">导入我方</button>
                        <button onClick={() => onImportEnemyTeam(validBuilds.map(b => b.monster!))} className="flex-1 text-xs py-1 rounded bg-red-50 text-red-600 hover:bg-red-100">导入敌方</button>
                        <button onClick={() => saveTemplate(item.snapshot.team.name, members)} className="text-xs px-2 py-1 rounded bg-zinc-50 text-zinc-400 hover:text-amber-500" title="保存为模板">保存</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )
        )}
      </div>
    </div>
  );
}
