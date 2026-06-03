import { useState, useEffect, useRef } from "react";
import type { Monster, Personality, Move } from "../lib/types";
import type { Talent } from "../lib/calculator";
import { DEFAULT_TALENT } from "../lib/calculator";
import { MonsterSearch } from "./MonsterSearch";
import { MonsterCard } from "./MonsterCard";
import { QuickImport } from "./QuickImport";
import { Icon } from "./Icon";
import { formatPersonality } from "../lib/popularStats";
import monstersDetail from "../data/monsters_detail.json";
import popularMovesData from "../data/popular_moves.json";
import allMovesData from "../data/moves.json";

const detailMap = new Map((monstersDetail as Monster[]).map((m) => [m.id, m]));
const popularMoves = popularMovesData as Record<string, number[]>;
const allMoves = allMovesData as Move[];

export interface TeamMember {
  monster: Monster;
  personality: Personality | null;
  talent: Talent;
  selectedMoves: Move[];
  bloodline: Monster["default_legacy_type"] | null;
  captureBall?: string | null;    // 咕噜球类型
  beastBloodline?: string | null; // 稀兽花宝血脉选择
}

interface SavedTeam {
  id: string;
  name: string;
  members: TeamMember[];
  magicItem: string;
}

const STORAGE_KEY = "roco_saved_teams";

function loadTeams(): SavedTeam[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data;
  } catch {
    return [];
  }
}

function persistTeams(teams: SavedTeam[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(teams));
}

interface Props {
  onTeamChange: (team: TeamMember[]) => void;
  onActiveChange: (index: number) => void;
  onStarterChange?: (index: number) => void;
  onMagicItemChange?: (item: string) => void;
  // 外部一键导入：值变化时新建队伍并切换
  importTrigger?: { members: TeamMember[]; name?: string; ts: number } | null;
}

export function TeamPanel({ onTeamChange, onActiveChange, onStarterChange, onMagicItemChange, importTrigger }: Props) {
  const [savedTeams, setSavedTeams] = useState<SavedTeam[]>(() => {
    const teams = loadTeams();
    if (teams.length === 0) {
      const defaultTeam: SavedTeam = {
        id: Date.now().toString(36),
        name: "个人配队1",
        members: [],
        magicItem: "willpower_enhancement",
      };
      persistTeams([defaultTeam]);
      return [defaultTeam];
    }
    return teams;
  });
  const [activeTeamId, setActiveTeamId] = useState<string>(() => savedTeams[0]?.id ?? "");
  const [activeIndex, setActiveIndex] = useState(0);
  const [editIndex, setEditIndex] = useState(0);
  const [starterIndex, setStarterIndex] = useState(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [editing, setEditing] = useState(false);
  const skipSave = useRef(true);
  const switcherRef = useRef<HTMLDivElement>(null);

  const activeTeam = savedTeams.find((t) => t.id === activeTeamId) ?? savedTeams[0] ?? null;
  const members: TeamMember[] = activeTeam?.members ?? [];
  const active = members[editIndex] ?? null;

  const memberBaseNames = members.map((m) => {
    const idx = m.monster.localized.zh.name.indexOf("（");
    return idx === -1 ? m.monster.localized.zh.name : m.monster.localized.zh.name.slice(0, idx);
  });

  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    persistTeams(savedTeams);
  }, [savedTeams]);

  // 外部 importTrigger 变化时：新建队伍 + 切换 + 重置激活下标
  const lastImportTsRef = useRef<number>(0);
  useEffect(() => {
    if (!importTrigger || importTrigger.ts <= lastImportTsRef.current) return;
    lastImportTsRef.current = importTrigger.ts;
    const newTeam: SavedTeam = {
      id: Date.now().toString(36),
      name: importTrigger.name || `导入配队 ${new Date().toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`,
      members: importTrigger.members,
      magicItem: "willpower_enhancement",
    };
    setSavedTeams((prev) => [newTeam, ...prev]);
    setActiveTeamId(newTeam.id);
    setActiveIndex(0);
    setEditIndex(0);
    setStarterIndex(0);
  }, [importTrigger]);

  useEffect(() => {
    onTeamChange(members);
  }, [members, onTeamChange]);

  useEffect(() => {
    onActiveChange(activeIndex);
  }, [activeIndex, onActiveChange]);

  useEffect(() => {
    onStarterChange?.(starterIndex);
  }, [starterIndex, onStarterChange]);

  useEffect(() => {
    onMagicItemChange?.(activeTeam?.magicItem || "willpower_enhancement");
  }, [activeTeam?.magicItem, onMagicItemChange]);

  // Close switcher on outside click
  useEffect(() => {
    if (!showSwitcher) return;
    const handler = (e: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setShowSwitcher(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSwitcher]);

  // Ensure activeIndex is valid when members change
  useEffect(() => {
    if (editIndex >= members.length) {
      setEditIndex(Math.max(0, members.length - 1));
    }
  }, [members.length, editIndex]);

  const updateMembers = (newMembers: TeamMember[]) => {
    setSavedTeams((prev) =>
      prev.map((t) => (t.id === activeTeamId ? { ...t, members: newMembers } : t))
    );
  };

  const addMember = (monster: Monster) => {
    if (members.length >= 6) return;
    const detail = detailMap.get(monster.id);
    const pool = (detail?.move_pool || []) as Move[];
    // Use B站 recommended moves if available, otherwise first 4 from pool
    const recommended = popularMoves[String(monster.id)];
    const defaultMoves = recommended
      ? recommended.map((mid: number) => pool.find(m => m.id === mid) || allMoves.find(m => m.id === mid)).filter(Boolean) as Move[]
      : pool.slice(0, 4);
    const newMembers = [
      ...members,
      { monster, personality: null, talent: DEFAULT_TALENT, selectedMoves: defaultMoves, bloodline: monster.default_legacy_type || null, captureBall: null, beastBloodline: null },
    ];
    updateMembers(newMembers);
    setActiveIndex(newMembers.length - 1);
    setEditIndex(newMembers.length - 1);
  };

  const removeMember = (index: number) => {
    const newMembers = members.filter((_, i) => i !== index);
    updateMembers(newMembers);
    if (activeIndex >= newMembers.length) {
      setActiveIndex(Math.max(0, newMembers.length - 1));
    } else if (activeIndex > index) {
      setActiveIndex(activeIndex - 1);
    }
    if (editIndex >= newMembers.length) {
      setEditIndex(Math.max(0, newMembers.length - 1));
    } else if (editIndex > index) {
      setEditIndex(editIndex - 1);
    }
    if (starterIndex >= newMembers.length) {
      setStarterIndex(Math.max(0, newMembers.length - 1));
    } else if (starterIndex > index) {
      setStarterIndex(starterIndex - 1);
    }
  };

  const updatePersonality = (p: Personality) => {
    const newMembers = [...members];
    newMembers[editIndex] = { ...newMembers[editIndex], personality: p };
    updateMembers(newMembers);
  };

  const updateTalent = (t: Talent) => {
    const newMembers = [...members];
    newMembers[editIndex] = { ...newMembers[editIndex], talent: t };
    updateMembers(newMembers);
  };

  const updateMoves = (moves: Move[]) => {
    const newMembers = [...members];
    newMembers[editIndex] = { ...newMembers[editIndex], selectedMoves: moves };
    updateMembers(newMembers);
  };

  const updateBloodline = (bl: Monster["default_legacy_type"] | null) => {
    const newMembers = [...members];
    newMembers[editIndex] = { ...newMembers[editIndex], bloodline: bl };
    updateMembers(newMembers);
  };

  const updateCaptureBall = (ball: string | null) => {
    const newMembers = [...members];
    newMembers[editIndex] = { ...newMembers[editIndex], captureBall: ball };
    updateMembers(newMembers);
  };

  const updateBeastBloodline = (bl: string | null) => {
    const newMembers = [...members];
    newMembers[editIndex] = { ...newMembers[editIndex], beastBloodline: bl };
    updateMembers(newMembers);
  };

  const switchTeam = (id: string) => {
    setActiveTeamId(id);
    setActiveIndex(0);
    setEditIndex(0);
    setStarterIndex(0);
    setShowSwitcher(false);
  };

  const createTeam = () => {
    const nums = savedTeams
      .map((t) => t.name.match(/^个人配队(\d+)$/))
      .filter(Boolean)
      .map((m) => parseInt(m![1], 10));
    const nextNum = nums.length > 0 ? Math.max(...nums) + 1 : savedTeams.length + 1;
    const newTeam: SavedTeam = {
      id: Date.now().toString(36),
      name: `个人配队${nextNum}`,
      members: [],
      magicItem: "willpower_enhancement",
    };
    setSavedTeams((prev) => [...prev, newTeam]);
    setActiveTeamId(newTeam.id);
    setActiveIndex(0);
    setEditIndex(0);
    setStarterIndex(0);
    setShowSwitcher(false);
  };

  const deleteTeam = (id: string) => {
    if (savedTeams.length <= 1) return;
    const remaining = savedTeams.filter((t) => t.id !== id);
    setSavedTeams(remaining);
    if (activeTeamId === id) {
      setActiveTeamId(remaining[0].id);
      setActiveIndex(0);
      setEditIndex(0);
      setStarterIndex(0);
    }
  };

  const startRename = (id: string) => {
    const team = savedTeams.find((t) => t.id === id);
    if (!team) return;
    setRenamingId(id);
    setRenameValue(team.name);
  };

  const confirmRename = () => {
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    setSavedTeams((prev) =>
      prev.map((t) => (t.id === renamingId ? { ...t, name: renameValue.trim() } : t))
    );
    setRenamingId(null);
  };

  const activeDetail = active ? detailMap.get(active.monster.id) : null;
  const activeMovePool = (activeDetail?.move_pool || []) as Move[];

  if (!activeTeam) {
    return (
      <div className="bg-blue-50/60 border border-blue-200 rounded-xl p-3">
        <label className="block text-sm font-semibold text-zinc-800 mb-2">我方队伍</label>
        <button
          onClick={createTeam}
          className="text-sm px-4 py-2 rounded-lg border border-dashed border-zinc-300 text-zinc-500 hover:border-indigo-300 hover:text-indigo-500"
        >
          + 创建配队
        </button>
      </div>
    );
  }

  return (
    <div className="bg-blue-50/60 border border-blue-200 rounded-xl p-3">
      {/* Team header bar */}
      <div className="flex items-center gap-2 mb-2">
        <label className="text-sm font-semibold text-zinc-800 shrink-0">我方队伍</label>

        <QuickImport
          label="我方"
          onImportFullMembers={(fullMembers, magicItem) => {
            // 一键完整导入：新建队伍 + 切换 + 6 只精灵带技能/性格/血脉/魔法
            const newTeam: SavedTeam = {
              id: Date.now().toString(36),
              name: `导入配队 ${new Date().toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`,
              members: fullMembers.slice(0, 6),
              magicItem: magicItem || "willpower_enhancement",
            };
            setSavedTeams((prev) => [newTeam, ...prev]);
            setActiveTeamId(newTeam.id);
            setActiveIndex(0);
            setEditIndex(0);
            setStarterIndex(0);
            // 同步魔法道具到 App.tsx
            onMagicItemChange?.(magicItem || newTeam.magicItem);
          }}
          onImport={(monsters) => {
            for (const monster of monsters) {
              if (members.length >= 6) break;
              addMember(monster);
            }
          }}
        />

        {members.length > 0 && (
          <button
            onClick={() => {
              const talentKeys: [keyof Talent, string][] = [
                ["hp_boost","生命"],["phy_atk_boost","物攻"],["mag_atk_boost","魔攻"],
                ["phy_def_boost","物防"],["mag_def_boost","魔防"],["spd_boost","速度"]
              ];
              const magicName = activeTeam?.magicItem === "evolution_power" ? "进化之力" : "愿力强化";
              // Official readable format
              const officialLines = members.map(m => {
                const bl = m.bloodline || m.monster.default_legacy_type || m.monster.main_type;
                const moves = m.selectedMoves.map(mv => mv.localized.zh.name).join("、");
                return `# ${m.monster.localized.zh.name}：${bl.localized.zh}血脉、{${moves}}`;
              });
              const official = `### ${activeTeam?.name || "我的队伍"}\n# 魔法：${magicName}\n#\n${officialLines.join("\n")}`;
              // Our data format
              const dataLines = members.map(m => {
                const p = m.personality ? formatPersonality(m.personality) : "平衡";
                const t = talentKeys.filter(([k]) => m.talent[k] > 0).map(([k, l]) => `（${l}+${m.talent[k]}）`).join("");
                const moves = m.selectedMoves.map(mv => mv.localized.zh.name).join("/");
                return `${m.monster.localized.zh.name}#${m.monster.dex_number}//${p}//${t}${moves}`;
              });
              const code = `${official}\n#\n# --- 完整数据（可粘贴到公式导入） ---\n#\n${dataLines.join("||")}`;
              navigator.clipboard.writeText(code).then(() => alert("已复制到剪贴板")).catch(() => alert(code));
            }}
            className="text-xs px-2 py-0.5 rounded border border-dashed border-zinc-300 text-zinc-400 hover:border-green-300 hover:text-green-500"
            title="导出队伍代码"
          >导出</button>
        )}

        {/* Team switcher */}
        <div ref={switcherRef} className="relative">
          <button
            onClick={() => setShowSwitcher(!showSwitcher)}
            className="text-xs px-2 py-0.5 rounded border border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 flex items-center gap-1 min-w-0 max-w-[140px]"
          >
            <span className="truncate">{activeTeam.name}</span>
            <span className="text-zinc-400 shrink-0">({members.length}/6)</span>
            <Icon name="chevron-down" size={12} className="shrink-0" />
          </button>

          {showSwitcher && (
            <div className="absolute top-full mt-1 left-0 bg-white border border-zinc-200 rounded-lg shadow-lg z-20 min-w-[180px]">
              {savedTeams.map((t) => (
                <div
                  key={t.id}
                  className={`flex items-center px-2.5 py-1.5 text-xs ${
                    t.id === activeTeamId ? "bg-indigo-50 text-indigo-700" : "text-zinc-700"
                  }`}
                >
                  {renamingId === t.id ? (
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={confirmRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") confirmRename();
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs w-20 border border-zinc-300 rounded px-1 outline-none"
                      autoFocus
                    />
                  ) : (
                    <button
                      onClick={() => switchTeam(t.id)}
                      className="flex-1 text-left truncate hover:text-indigo-600"
                    >
                      {t.name}
                    </button>
                  )}
                  <span className="text-zinc-400 mx-1.5 shrink-0">{t.members.length}/6</span>
                  <button
                    onClick={() => startRename(t.id)}
                    className="text-zinc-400 hover:text-indigo-500 shrink-0 text-xs px-0.5"
                    title="重命名"
                  >
                    <Icon name="edit" size={12} />
                  </button>
                  {savedTeams.length > 1 && (
                    <button
                      onClick={() => deleteTeam(t.id)}
                      className="text-zinc-400 hover:text-red-500 shrink-0 text-xs px-0.5"
                      title="删除"
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={createTeam}
                className="w-full text-xs px-2.5 py-1.5 text-indigo-500 hover:bg-indigo-50 border-t border-zinc-100 flex items-center gap-1"
              >
                <Icon name="plus" size={12} /> 新建配队
              </button>
            </div>
          )}
        </div>

        {/* Magic item selector */}
        <select
          value={activeTeam?.magicItem || "willpower_enhancement"}
          onChange={(e) => {
            setSavedTeams((prev) =>
              prev.map((t) => (t.id === activeTeamId ? { ...t, magicItem: e.target.value } : t))
            );
          }}
          disabled={!editing}
          className={`text-xs border border-zinc-200 rounded px-1.5 py-0.5 ${editing ? "text-zinc-600" : "text-zinc-400 bg-zinc-50"}`}
          title="共鸣魔法"
        >
          <option value="evolution_power">进化之力</option>
          <option value="willpower_enhancement">愿力强化</option>
        </select>

        {/* Edit toggle */}
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          <button
            onClick={() => setEditing(!editing)}
            className={`text-xs px-3 py-1 rounded-lg border transition-colors ${
              editing
                ? "bg-indigo-500 border-indigo-500 text-white"
                : "border-zinc-200 text-zinc-500 hover:border-indigo-300 hover:text-indigo-600"
            }`}
          >
            {editing ? "完成" : "编辑配队"}
          </button>
        </div>
      </div>

      {/* Member chips row (always visible when members exist) */}
      {members.length > 0 && (
        <div className="flex gap-1.5 mb-2 flex-wrap items-center">
          {members.map((member, i) => (
            <button
              key={i}
              onClick={() => setEditIndex(i)}
              onDoubleClick={(e) => { e.preventDefault(); setActiveIndex(i); setEditIndex(i); setStarterIndex(i); onActiveChange(i); }}
              title="单击查看详情 · 双击登场对战"
              className={`relative text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                i === editIndex
                  ? "bg-blue-50 border-blue-300 text-blue-700 font-medium"
                  : "bg-white border-zinc-200 text-zinc-600 hover:border-blue-200"
              }`}
            >
              {i === starterIndex && <span className="text-xs text-amber-500 mr-0.5">⭐</span>}
              {member.monster.localized.zh.name}
              <span
                onClick={(e) => { e.stopPropagation(); removeMember(i); }}
                className="ml-1 text-zinc-400 hover:text-red-500"
              >
                ×
              </span>
            </button>
          ))}
          <span className="text-xs text-zinc-400">（单击查看详情，双击登场）</span>
        </div>
      )}

      {/* Editing area */}
      {editing && (
        <>
          {members.length < 6 && (
            <div className="mb-3">
              <MonsterSearch label="添加精灵" onSelect={addMember} excludeBaseNames={memberBaseNames} />
            </div>
          )}

          {active && (
            <MonsterCard
              monster={active.monster}
              personality={active.personality}
              onPersonalityChange={updatePersonality}
              talent={active.talent}
              onTalentChange={updateTalent}
              movePool={activeMovePool}
              selectedMoves={active.selectedMoves}
              onMovesChange={updateMoves}
              bloodline={active.bloodline}
              onBloodlineChange={updateBloodline}
              captureBall={active.captureBall}
              onCaptureBallChange={updateCaptureBall}
              beastBloodline={active.beastBloodline}
              onBeastBloodlineChange={updateBeastBloodline}
            />
          )}
        </>
      )}
    </div>
  );
}
