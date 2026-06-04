import { useState, useMemo, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { TeamPanel } from "./components/TeamPanel";
import type { TeamMember } from "./components/TeamPanel";
import { EnemyPanel } from "./components/EnemyPanel";
import { MatchupAnalysis } from "./components/MatchupAnalysis";
import { FeaturedTeams } from "./components/FeaturedTeams";
import { Pokedex } from "./components/Pokedex";
import { Tutorial } from "./components/Tutorial";
import { ReplayAnalysis } from "./components/ReplayAnalysis";
import { Icon } from "./components/Icon";
import { analyzeMoves, analyzeMatchup } from "./lib/battle";
import { calcStats, DEFAULT_TALENT } from "./lib/calculator";
import { getTypeEffectiveness } from "./lib/calculator";
import { getTurnAdvice, preloadBattleContext, buildTeamAnalysis, clearBattleContext, getApiKey, setApiKey as setAiApiKey, clearApiKey as clearAiApiKey } from "./lib/aiAdvisor";
import { truncateAfter as aiTruncateAfter, restoreActiveSession, getAssistantHistory } from "./lib/aiSession";

// Strip markdown formatting from AI response
function cleanMarkdown(text: string): string {
  return text
    .replace(/^#{1,4}\s+/gm, "")   // ## headers
    .replace(/\*\*(.+?)\*\*/g, "$1") // **bold**
    .replace(/\*(.+?)\*/g, "$1")     // *italic*
    .replace(/`(.+?)`/g, "$1")       // `code`
    .replace(/^[-*]\s+/gm, "· ")     // bullet lists
    .replace(/\n{3,}/g, "\n\n")      // collapse extra newlines
    .trim();
}
import type { Monster, Personality, Move, TypeInfo } from "./lib/types";
import monstersDetail from "./data/monsters_detail.json";
import typesData from "./data/types.json";
import "./App.css";

// AI snap helpers
function fmtBuffs(b: any): string {
  if (!b?.pctBuffs) return "";
  const n: Record<string,string>={phyAtk:"物攻",magAtk:"魔攻",phyDef:"物防",magDef:"魔防",spd:"速度"};
  return Object.entries(b.pctBuffs as Record<string,number>).filter(([,v])=>v!==0).map(([k,v])=>`${n[k]||k}${v>0?"+"+v:v}%`).join(" ");
}
function fmtLog(b: any, n=3): {turn:number;myMove:string;enemyMove:string}[] {
  if (!b?.log?.length) return [];
  return b.log.slice(-n).map((l:any)=>({turn:l.turn,
    myMove:l.myAction?.type==="move"?l.myAction.move?.localized?.zh?.name||"?":l.myAction?.type||"?",
    enemyMove:l.enemyAction?.type==="move"?l.enemyAction.move?.localized?.zh?.name||"?":l.enemyAction?.type||"?"}));
}

const allTypes = typesData as TypeInfo[];

const detailMap = new Map(
  (monstersDetail as Monster[]).map((m) => [m.id, m])
);

const DEFAULT_PERSONALITY: Personality = {
  id: 0, name: "Neutral", localized: { zh: "平衡" },
  hp_mod_pct: 0, phy_atk_mod_pct: 0, mag_atk_mod_pct: 0,
  phy_def_mod_pct: 0, mag_def_mod_pct: 0, spd_mod_pct: 0,
};

type Page = "battle" | "pokedex" | "teams" | "replay" | "tutorial" | "settings";

const PAGES: { key: Page; label: string; icon: "sword" | "book" | "users" | "play" | "school" | "settings" }[] = [
  { key: "battle", label: "对战", icon: "sword" },
  { key: "replay", label: "复盘", icon: "play" },
  { key: "teams", label: "配队", icon: "users" },
  { key: "pokedex", label: "图鉴", icon: "book" },
  { key: "tutorial", label: "教程", icon: "school" },
  { key: "settings", label: "设置", icon: "settings" },
];

function App() {
  const [page, setPage] = useState<Page>("battle");
  const [pageKey, setPageKey] = useState(0);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [teamMagicItem, setTeamMagicItem] = useState("willpower_enhancement");
  const [aiAdvice, setAiAdvice] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiHistory, setAiHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("roco_ai_history") || "[]"); } catch { return []; }
  });

  const saveAiAdvice = (text: string) => {
    if (!text) return;
    setAiAdvice(text);
    setAiHistory(prev => {
      const next = [text, ...prev].slice(0, 20);
      localStorage.setItem("roco_ai_history", JSON.stringify(next));
      return next;
    });
  };
  const [aiKey, setAiKey] = useState(() => getApiKey() || "");
  const [battlePhase, setBattlePhase] = useState<"idle" | "preloaded">("idle");
  const [adviceMode, setAdviceMode] = useState<"ai" | "rule">("ai");
  const currentBattleRef = useRef<any>(null);
  const [turnCount, setTurnCount] = useState(1);
  const [enemyTeam, setEnemyTeam] = useState<Monster[]>([]);
  const [teamImportTrigger, setTeamImportTrigger] = useState<{ members: TeamMember[]; name?: string; ts: number } | null>(null);
  // 撤销 AI 对话提示条
  const [aiUndoNotice, setAiUndoNotice] = useState<{ count: number; targetTurn: number } | null>(null);

  // 启动时恢复活动会话（页面刷新场景）
  useEffect(() => {
    restoreActiveSession();
  }, []);

  // 撤销 AI 对话至 targetTurn 之前（含）—— 配合 BattleState 撤销使用
  const undoAIToTurn = (targetTurn: number) => {
    const removed = aiTruncateAfter(targetTurn);
    if (removed.length > 0) {
      setAiUndoNotice({ count: removed.length, targetTurn });
      setTimeout(() => setAiUndoNotice(null), 4000);
      // UI 上的 aiAdvice / aiHistory 同步刷新
      const history = getAssistantHistory();
      const last = history[history.length - 1];
      setAiAdvice(last ? cleanMarkdown(last.reply) : "");
      setAiHistory(history.map((h) => h.reply));
      try { localStorage.setItem("roco_ai_history", JSON.stringify(history.map((h) => h.reply))); } catch {}
    }
  };

  // 添加第一只敌方首发精灵时自动预加载 AI
  useEffect(() => {
    if (battlePhase === "idle" && getApiKey() && team.some(t => t.monster) && enemyTeam.length === 1) {
      try {
        const myMonsters = team.filter(t => t.monster).map(t => t.monster);
        const { matrix, analysis } = buildTeamAnalysis(myMonsters, enemyTeam, detailMap);
        preloadBattleContext(myMonsters, enemyTeam, matrix, analysis);
        setBattlePhase("preloaded");
      } catch { /* skip */ }
    }
    // Clear preload when enemy team is emptied
    if (enemyTeam.length === 0 && battlePhase === "preloaded") {
      clearBattleContext();
      setBattlePhase("idle");
      setAiAdvice("");
    }
  }, [enemyTeam.length, team, battlePhase]);
  const [enemyActiveIndex, setEnemyActiveIndex] = useState(0);
  const [rankMode, setRankMode] = useState<"below_master" | "master_plus">("below_master");
  const [pinned, setPinned] = useState(false);
  const [fontSize, setFontSize] = useState<"sm" | "md" | "lg">(() => {
    const saved = localStorage.getItem("fontSize");
    return saved === "sm" || saved === "lg" ? saved : "md";
  });
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("darkMode") === "true");
  const [updateMsg, setUpdateMsg] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      getCurrentWindow().isAlwaysOnTop().then(setPinned).catch(() => {});
    } catch { /* not running inside Tauri */ }
  }, []);

  useEffect(() => {
    const sizes = { sm: "14px", md: "16px", lg: "18px" };
    document.documentElement.style.fontSize = sizes[fontSize];
    localStorage.setItem("fontSize", fontSize);
  }, [fontSize]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("darkMode", String(darkMode));
  }, [darkMode]);

  const goPage = (p: Page) => {
    if (p === page) return;
    setPage(p);
    setPageKey((k) => k + 1);
    // reset scroll
    contentRef.current?.scrollTo(0, 0);
  };

  const togglePin = async () => {
    try {
      const win = getCurrentWindow();
      const next = !pinned;
      await win.setAlwaysOnTop(next);
      setPinned(next);
    } catch { /* not running inside Tauri */ }
  };

  const active = team[activeIndex] ?? null;
  const defender = enemyTeam[enemyActiveIndex] ?? null;

  const damageAnalysis = useMemo(() => {
    if (!active || !defender) return [];
    const atkStats = calcStats(active.monster, active.personality || DEFAULT_PERSONALITY, active.talent);
    const defStats = calcStats(defender, DEFAULT_PERSONALITY, DEFAULT_TALENT);
    const moves = active.selectedMoves.length > 0 ? active.selectedMoves : ((detailMap.get(active.monster.id)?.move_pool || []) as Move[]);
    return analyzeMoves(active.monster, defender, atkStats, defStats, moves);
  }, [active, defender]);

  const reverseDamageAnalysis = useMemo(() => {
    if (!active || !defender) return [];
    const atkStats = calcStats(active.monster, active.personality || DEFAULT_PERSONALITY, active.talent);
    const defStats = calcStats(defender, DEFAULT_PERSONALITY, DEFAULT_TALENT);
    const detail = detailMap.get(defender.id);
    const movePool = (detail?.move_pool || []) as Move[];
    return analyzeMoves(defender, active.monster, defStats, atkStats, movePool);
  }, [active, defender]);

  const aiTriggeredRef = useRef(false);

  // 开局后自动触发首次 AI 分析
  useEffect(() => {
    if (battlePhase === "preloaded" && active && defender && getApiKey() && !aiTriggeredRef.current) {
      aiTriggeredRef.current = true;
      setAiLoading(true); setAiAdvice("");
      const snap = {
        turn: 1,
        myActive: {
          name: active.monster.localized.zh.name,
          hp: 100, maxHp: 100, energy: 10,
          burnLayers: 0, poisonLayers: 0, freezeLayers: 0,
          regressionLayers: 0, defending: false, stunned: false, pctBuffs: "",
        },
        enemyActive: {
          name: defender.localized.zh.name,
          hp: 100, maxHp: 100, energy: 10,
          burnLayers: 0, poisonLayers: 0, freezeLayers: 0,
          regressionLayers: 0, defending: false, stunned: false, pctBuffs: "",
        },
        weather: "无", marks: "无",
        history: [],
        myTeamAlive: team.filter(t => t.monster).map(t => t.monster.localized.zh.name),
        enemyTeamAlive: enemyTeam.map(e => e.localized.zh.name),
        myMagicAvailable: teamMagicItem === "evolution_power" ? "进化之力" : teamMagicItem === "willpower_enhancement" ? "愿力强化" : "无",
        mySkills: active.selectedMoves.length > 0 ? active.selectedMoves.map(mv => `${mv.localized.zh.name}(${mv.energy_cost}费${mv.power||0}威)`).join(" ") : ((detailMap.get(active.monster.id)?.move_pool || []) as Move[]).slice(0,4).map((mv: Move) => `${mv.localized.zh.name}(${mv.energy_cost}费${mv.power||0}威)`).join(" "),
        enemySkills: ((detailMap.get(defender.id)?.move_pool || []) as Move[]).map((mv: Move) => `${mv.localized.zh.name}(${mv.energy_cost}费${mv.power||0}威)`).join(" "),
        matchupTip: matchup?.pressure || "?",
        ruleSuggestion: damageAnalysis.filter(d=>d.move.power).slice(0,2).map(d=>d.move.localized.zh.name+d.hpPercent.max+"%").join(" "),
      };
      getTurnAdvice(snap, { turnId: 1 }).then(r => {
        if (r === "__ABORTED__") { setAiLoading(false); return; }
        saveAiAdvice(cleanMarkdown(r)); setAiLoading(false);
      }).catch(() => { setAiAdvice("AI 请求失败"); setAiLoading(false); });
    }
    if (battlePhase !== "preloaded") {
      aiTriggeredRef.current = false;
    }
  }, [battlePhase, active, defender]);

  const speedComparison = useMemo(() => {
    if (!active || !defender) return null;
    const atkStats = calcStats(active.monster, active.personality || DEFAULT_PERSONALITY, active.talent);
    const defStats = calcStats(defender, DEFAULT_PERSONALITY, DEFAULT_TALENT);
    return { atkSpd: atkStats.spd, defSpd: defStats.spd };
  }, [active, defender]);

  const matchup = useMemo(() => {
    if (!active || !defender) return null;
    const atkStats = calcStats(active.monster, active.personality || DEFAULT_PERSONALITY, active.talent);
    const defStats = calcStats(defender, DEFAULT_PERSONALITY, DEFAULT_TALENT);
    const atkMoves = active.selectedMoves.length > 0 ? active.selectedMoves : ((detailMap.get(active.monster.id)?.move_pool || []) as Move[]);
    const defDetail = detailMap.get(defender.id);
    const defMoves = (defDetail?.move_pool || []) as Move[];
    if (atkMoves.length === 0 && defMoves.length === 0) return null;
    return analyzeMatchup(active.monster, defender, atkStats, defStats, atkMoves, defMoves);
  }, [active, defender]);

  const battleSuggestions = useMemo(() => {
    if (enemyTeam.length === 0) return [{ type: "hint" as const, text: "添加对方精灵" }];
    if (!active || !defender || !matchup || !speedComparison) return [{ type: "hint" as const, text: "选中双方精灵" }];

    const mySpd = speedComparison.atkSpd;
    const enemySpd = speedComparison.defSpd;
    const isFaster = mySpd > enemySpd;
    const bestAtk = damageAnalysis.filter(d => d.move.power).sort((a, b) => b.hpPercent.max - a.hpPercent.max)[0];
    const enemyBestAtk = reverseDamageAnalysis.filter(d => d.move.power).sort((a, b) => b.hpPercent.max - a.hpPercent.max)[0];

    const canKo = bestAtk && bestAtk.hpPercent.max >= 100;
    const canTwoHitKo = bestAtk && bestAtk.hpPercent.max >= 50;
    const enemyCanKo = enemyBestAtk && enemyBestAtk.hpPercent.max >= 100;
    const enemyCanTwoHitKo = enemyBestAtk && enemyBestAtk.hpPercent.max >= 50;

    // Find best switch-in: resists defender's STAB
    const switchIn = team
      .map((m, i) => ({ m, i }))
      .filter(({ i }) => i !== activeIndex)
      .find(({ m }) => {
        const myTypes: TypeInfo[] = [allTypes.find(t => t.name === m.monster.main_type.name)!].filter(Boolean);
        const sub = m.monster.sub_type;
        if (sub) { const st = allTypes.find(t => t.name === sub.name); if (st) myTypes.push(st); }
        return getTypeEffectiveness(defender.main_type.name, myTypes) < 1;
      });

    type Line = { type: "danger" | "warn" | "good" | "hint"; text: string };
    const result: Line[] = [];

    // === 决策树 ===

    // 1. 对方能秒杀且先手 → 必须行动
    if (enemyCanKo && !isFaster) {
      if (switchIn) {
        result.push({ type: "danger", text: `换「${switchIn.m.monster.localized.zh.name}」` });
      } else {
        result.push({ type: "danger", text: `防御` });
      }
      result.push({ type: "hint", text: `对方「${enemyBestAtk.move.localized.zh.name}」${enemyBestAtk.hpPercent.max}%` });
      return result;
    }

    // 2. 我方能秒杀 → 击倒
    if (canKo) {
      result.push({ type: "good", text: `「${bestAtk.move.localized.zh.name}」击倒` });
      if (!isFaster && enemyCanKo) result.push({ type: "warn", text: `猜拳 · 对方也可秒` });
      return result;
    }

    // 3. 我方压制 → 进攻
    if (matchup.pressure === "a→b" && bestAtk) {
      result.push({ type: "good", text: `「${bestAtk.move.localized.zh.name}」${bestAtk.hpPercent.max}%` });
      if (matchup.aKoTurns !== undefined && matchup.aKoTurns <= 3) {
        result.push({ type: "hint", text: `${matchup.aKoTurns}T击倒` });
      }
      return result;
    }

    // 4. 对方压制 → 换人
    if (matchup.pressure === "b→a") {
      if (switchIn) {
        result.push({ type: "warn", text: `换「${switchIn.m.monster.localized.zh.name}」` });
      } else {
        result.push({ type: "warn", text: `防御` });
      }
      if (enemyBestAtk) result.push({ type: "hint", text: `对方「${enemyBestAtk.move.localized.zh.name}」${enemyBestAtk.hpPercent.max}%` });
      return result;
    }

    // 5. 均势
    if (isFaster && canTwoHitKo && bestAtk) {
      result.push({ type: "good", text: `「${bestAtk.move.localized.zh.name}」先手施压` });
    } else if (!isFaster && enemyCanTwoHitKo) {
      result.push({ type: "warn", text: `防御 · 后手` });
    } else {
      result.push({ type: "hint", text: `自由操作` });
    }

    // === 补充信息（WSS理论） ===

    // Check/Counter 关系
    if (matchup.aChecksB && matchup.aCountersB) {
      result.push({ type: "hint", text: `我方 Counter 对方（可安全换入击倒）` });
    } else if (matchup.aChecksB) {
      result.push({ type: "hint", text: `我方 Check 对方（同时入场可击倒）` });
    }
    if (matchup.bChecksA && matchup.bCountersA) {
      result.push({ type: "hint", text: `对方 Counter 我方（对方可安全换入）` });
    } else if (matchup.bChecksA) {
      result.push({ type: "hint", text: `对方 Check 我方` });
    }

    // 速度 + KO回合
    result.push({ type: "hint", text: `速度 ${mySpd}:${enemySpd} · 我方${matchup.aKoTurns === Infinity ? "无法击倒" : matchup.aKoTurns + "T"} · 敌方${matchup.bKoTurns === Infinity ? "无法击倒" : matchup.bKoTurns + "T"}` });

    // 我方伤害参考
    const topMoves = damageAnalysis.filter(d => d.move.power).slice(0, 3);
    if (topMoves.length > 0) {
      const items = topMoves.map(d => `${d.move.localized.zh.name}${d.hpPercent.max}%`).join(" ");
      result.push({ type: "hint", text: `我方：${items}` });
    }

    // 对方伤害参考
    const topEnemy = reverseDamageAnalysis.filter(d => d.move.power).slice(0, 3);
    if (topEnemy.length > 0) {
      const items = topEnemy.map(d => `${d.move.localized.zh.name}${d.hpPercent.max}%`).join(" ");
      result.push({ type: "hint", text: `敌方：${items}` });
    }

    // 对方可能换人（场下压力提示）
    if (matchup.pressure === "a→b" && enemyTeam.length > 1) {
      result.push({ type: "hint", text: `注意：对方可能换人回避压力` });
    }

    // === 博弈层级分析 ===
    if (active && defender && bestAtk) {
      const bestMoveType = bestAtk.move.move_type?.name || active.monster.main_type.name;

      const enemyResist = enemyTeam
        .filter(e => e.id !== defender.id)
        .find(e => {
          const eTypes: TypeInfo[] = [allTypes.find(t => t.name === e.main_type.name)!].filter(Boolean);
          if (e.sub_type) { const st = allTypes.find(t => t.name === e.sub_type!.name); if (st) eTypes.push(st); }
          return getTypeEffectiveness(bestMoveType, eTypes) < 1;
        });

      const myMoveVsResist = enemyResist ? (active.selectedMoves.length > 0 ? active.selectedMoves : (detailMap.get(active.monster.id)?.move_pool || []) as Move[])
        .filter(mv => {
          if (!mv.power || !mv.move_type) return false;
          const eTypes: TypeInfo[] = [allTypes.find(t => t.name === enemyResist.main_type.name)!].filter(Boolean);
          if (enemyResist.sub_type) { const st = allTypes.find(t => t.name === enemyResist.sub_type!.name); if (st) eTypes.push(st); }
          return getTypeEffectiveness(mv.move_type.name, eTypes) > 1;
        })[0] : undefined;

      result.push({ type: "hint", text: `── 博弈 ──` });
      result.push({ type: "hint", text: `0层：「${bestAtk.move.localized.zh.name}」${bestAtk.hpPercent.max}%` });

      if (enemyResist) {
        if (myMoveVsResist) {
          result.push({ type: "hint", text: `1层：对方换${enemyResist.localized.zh.name} → 先读「${myMoveVsResist.localized.zh.name}」` });
        } else {
          result.push({ type: "hint", text: `1层：对方换${enemyResist.localized.zh.name} → 无克制手段` });
        }
        result.push({ type: "hint", text: `2层：对方不换 → 「${bestAtk.move.localized.zh.name}」击倒` });
        if (myMoveVsResist) {
          result.push({ type: "hint", text: `3层：对方换 → 先读「${myMoveVsResist.localized.zh.name}」` });
        }
      } else {
        result.push({ type: "hint", text: `1层：对方无抗性换入 → 直接进攻` });
      }
    }

    // === 威胁标记 ===
    result.push({ type: "hint", text: `── 威胁 ──` });
    const threats = enemyTeam
      .map(e => {
        const eDetail = detailMap.get(e.id);
        const eMoves = ((eDetail?.move_pool || []) as Move[]).filter(m => m.power);
        const myTypes: TypeInfo[] = [allTypes.find(t => t.name === active.monster.main_type.name)!].filter(Boolean);
        if (active.monster.sub_type) { const st = allTypes.find(t => t.name === active.monster.sub_type!.name); if (st) myTypes.push(st); }
        const bestVsMe = eMoves.sort((a, b) => {
          const effA = getTypeEffectiveness(a.move_type?.name || "", myTypes);
          const effB = getTypeEffectiveness(b.move_type?.name || "", myTypes);
          return (b.power || 0) * effB - (a.power || 0) * effA;
        })[0];
        const eff = bestVsMe ? getTypeEffectiveness(bestVsMe.move_type?.name || "", myTypes) : 1;
        return { monster: e, threat: eff > 1 ? "高" : eff === 1 ? "中" : "低" };
      })
      .filter(t => t.threat === "高");
    if (threats.length > 0) {
      result.push({ type: "warn", text: `核心威胁：${threats.map(t => t.monster.localized.zh.name).join("、")}` });
    } else {
      result.push({ type: "good", text: `对方无高威胁精灵` });
    }

    // === 能量规划 ===
    if (active && bestAtk) {
      const currentEnergy = 10;
      const bestCost = bestAtk.move.energy_cost;
      if (bestCost > currentEnergy) {
        result.push({ type: "hint", text: `能量：需聚能${Math.ceil((bestCost - currentEnergy) / 5)}次才能用「${bestAtk.move.localized.zh.name}」` });
      }
    }

    // === 全队对位 ===
    if (team.length >= 2 && enemyTeam.length >= 2) {
      result.push({ type: "hint", text: `── 对位 ──` });
      for (const tm of team.slice(0, 4)) {
        const parts: string[] = [];
        for (const e of enemyTeam.slice(0, 4)) {
          const myTypes: TypeInfo[] = [allTypes.find(t => t.name === tm.monster.main_type.name)!].filter(Boolean);
          if (tm.monster.sub_type) { const st = allTypes.find(t => t.name === tm.monster.sub_type!.name); if (st) myTypes.push(st); }
          const eTypes: TypeInfo[] = [allTypes.find(t => t.name === e.main_type.name)!].filter(Boolean);
          if (e.sub_type) { const st = allTypes.find(t => t.name === e.sub_type!.name); if (st) eTypes.push(st); }
          const myEff = getTypeEffectiveness(tm.monster.main_type.name, eTypes);
          const eEff = getTypeEffectiveness(e.main_type.name, myTypes);
          const sym = myEff > 1 && eEff < 1 ? "✓" : myEff < 1 && eEff > 1 ? "✗" : myEff > 1 ? "△" : "—";
          parts.push(`${sym}${e.localized.zh.name.slice(0, 3)}`);
        }
        result.push({ type: "hint", text: `${tm.monster.localized.zh.name} ${parts.join(" ")}` });
      }
    }

    // === 对方可能操作 ===
    if (defender && reverseDamageAnalysis.length > 0) {
      result.push({ type: "hint", text: `── 对方 ──` });
      // Find affordable enemy moves sorted by threat
      const affordable = reverseDamageAnalysis
        .filter(d => d.move.energy_cost <= 10 && d.move.power)
        .sort((a, b) => b.hpPercent.max - a.hpPercent.max);
      if (affordable.length > 0) {
        const top = affordable.slice(0, 2);
        const items = top.map(d => `${d.move.localized.zh.name}(${d.hpPercent.max}%)${d.move.energy_cost}费`).join(" ");
        result.push({ type: "warn", text: `可能使用：${items}` });
      }
      // Check if enemy might switch
      if (matchup && matchup.pressure === "a→b" && enemyTeam.length > 1) {
        result.push({ type: "hint", text: `对方可能换人回避压力` });
      }
    }

    // === 若被击倒 ===
    if ((matchup?.pressure as string) === "b→a" && !active?.monster.leader_potential) {
      const bestSwitch = team
        .map((tm, i) => ({ tm, i }))
        .filter(({ i }) => i !== activeIndex)
        .sort((a, b) => {
          const aTypes: TypeInfo[] = [allTypes.find(t => t.name === a.tm.monster.main_type.name)!].filter(Boolean);
          if (a.tm.monster.sub_type) { const st = allTypes.find(t => t.name === a.tm.monster.sub_type!.name); if (st) aTypes.push(st); }
          const bTypes: TypeInfo[] = [allTypes.find(t => t.name === b.tm.monster.main_type.name)!].filter(Boolean);
          if (b.tm.monster.sub_type) { const st = allTypes.find(t => t.name === b.tm.monster.sub_type!.name); if (st) bTypes.push(st); }
          const aEff = getTypeEffectiveness(defender!.main_type.name, aTypes);
          const bEff = getTypeEffectiveness(defender!.main_type.name, bTypes);
          return aEff - bEff;
        });
      if (bestSwitch.length > 0 && bestSwitch[0]) {
        const bs = bestSwitch[0];
        result.push({ type: "hint", text: `若被击倒换「${bs.tm.monster.localized.zh.name}」` });
      }
    }

    // === 配队评分 ===
    if (team.length >= 3 && enemyTeam.length >= 3) {
      result.push({ type: "hint", text: `── 评分 ──` });
      let coverage = 0; let weakness = 0;
      for (const e of enemyTeam) {
        const eTypes: TypeInfo[] = [allTypes.find(t => t.name === e.main_type.name)!].filter(Boolean);
        if (e.sub_type) { const st = allTypes.find(t => t.name === e.sub_type!.name); if (st) eTypes.push(st); }
        const hasCounter = team.some(tm => getTypeEffectiveness(tm.monster.main_type.name, eTypes) > 1);
        const isWeak = team.every(tm => getTypeEffectiveness(e.main_type.name, [allTypes.find(t => t.name === tm.monster.main_type.name)!].filter(Boolean)) <= 1);
        if (hasCounter) coverage++;
        if (isWeak) weakness++;
      }
      const score = Math.round((coverage / Math.max(1, enemyTeam.length)) * 100);
      const grade = score >= 80 ? "S" : score >= 60 ? "A" : score >= 40 ? "B" : "C";
      result.push({ type: score >= 60 ? "good" : "warn", text: `克制覆盖 ${coverage}/${enemyTeam.length}（${grade}级）` });
      if (weakness > 0) result.push({ type: "warn", text: `${weakness}只敌方精灵无克制手段` });
    }

    // === 首发推荐 ===
    if (enemyTeam.length >= 3 && team.length >= 3) {
      result.push({ type: "hint", text: `── 首发 ──` });
      const starterScores = team.map((tm, idx) => {
        let score = 0;
        for (const e of enemyTeam) {
          const eTypes: TypeInfo[] = [allTypes.find(t => t.name === e.main_type.name)!].filter(Boolean);
          if (e.sub_type) { const st = allTypes.find(t => t.name === e.sub_type!.name); if (st) eTypes.push(st); }
          const eff = getTypeEffectiveness(tm.monster.main_type.name, eTypes);
          if (eff > 1) score += 2;
          else if (eff < 1) score -= 1;
        }
        return { name: tm.monster.localized.zh.name, score, idx };
      }).sort((a, b) => b.score - a.score);
      const best = starterScores[0];
      if (best && best.idx !== activeIndex) {
        result.push({ type: "hint", text: `推荐首发：${best.name}（克制${best.score}个对位）` });
      }
    }

    return result;
  }, [enemyTeam, active, defender, matchup, speedComparison, team, activeIndex, damageAnalysis, reverseDamageAnalysis]);

  return (
    <div className="min-h-screen bg-zinc-100">
      {/* Tab bar */}
      <header className="bg-gradient-to-b from-zinc-200 to-zinc-300/80 border-b border-zinc-300 select-none">
        <div className="max-w-5xl mx-auto flex items-end justify-between px-4 pt-1">
          <div className="flex items-end gap-0.5">
            <span className="text-sm font-bold text-zinc-500 mr-3 pb-2 select-none">
              ⚔ 洛克沙盘
            </span>
            {PAGES.map((p) => (
              <button
                key={p.key}
                onClick={() => goPage(p.key)}
                className={`relative text-sm px-3.5 py-2 rounded-t-lg border border-b-0 transition-all duration-150 flex items-center gap-1.5 ${
                  page === p.key
                    ? "bg-zinc-50 text-zinc-800 font-medium border-zinc-300 shadow-sm -mt-0.5"
                    : "bg-transparent text-zinc-500 border-transparent hover:bg-white/40 hover:text-zinc-700"
                }`}
              >
                <Icon name={p.icon} size={14} />
                {p.label}
              </button>
            ))}
            <span className="flex-1 border-b border-zinc-300" />
          </div>
          <div className="flex items-center gap-1.5 pb-1.5">
            <button onClick={togglePin}
              title={pinned ? "取消置顶" : "窗口置顶"}
              className={`text-xs px-2.5 py-1 rounded-md border transition-all duration-150 flex items-center gap-1 ${
                pinned
                  ? "bg-amber-100/80 border-amber-300 text-amber-700 shadow-sm"
                  : "bg-white/40 border-transparent text-zinc-400 hover:bg-white hover:border-zinc-300 hover:text-zinc-600 hover:shadow-sm"
              }`}>
              <Icon name="pin" size={13} className={pinned ? "fill-amber-500" : ""} />
              置顶
            </button>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main ref={contentRef} className="max-w-5xl mx-auto p-4">
        <div key={pageKey} className="page-enter">
          {page === "battle" && (
            <div className="space-y-4">
              <TeamPanel
                onTeamChange={setTeam}
                onActiveChange={setActiveIndex}
                onMagicItemChange={setTeamMagicItem}
                importTrigger={teamImportTrigger}
              />

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="flex flex-col gap-4">
                  <EnemyPanel
                    team={enemyTeam}
                    onTeamChange={setEnemyTeam}
                    activeIndex={enemyActiveIndex}
                    onActiveChange={setEnemyActiveIndex}
                    rankMode={rankMode}
                  />

                  <div className="bg-purple-100/70 border border-purple-300 rounded-xl p-3 flex-1 flex flex-col">
                    <div className="flex items-center justify-between mb-2 shrink-0">
                      <p className="text-sm font-semibold text-zinc-800">对局建议</p>
                      <div className="flex items-center gap-1.5">
                        {/* AI 分析按钮：有对战即显示 */}
                        {active && defender && (
                          <button
                            onClick={() => {
                              if (!getApiKey()) { setAiAdvice("请在设置页面配置 DeepSeek API Key"); return; }
                              setAiLoading(true); setAiAdvice("");
                              const b = currentBattleRef.current;
                              const myB = b?.myTeam?.[b?.myActive];
                              const enB = b?.enemyTeam?.[b?.enemyActive];
                              const snap = {
                                turn: b?.turn || turnCount,
                                myActive: {
                                  name: myB?.monster?.localized?.zh?.name || active?.monster?.localized?.zh?.name || "?",
                                  hp: myB?.currentHp ?? 100, maxHp: myB?.maxHp ?? 100,
                                  energy: myB?.energy ?? 10,
                                  burnLayers: myB?.burnLayers || 0, poisonLayers: myB?.poisonLayers || 0, freezeLayers: myB?.freezeLayers || 0,
                                  regressionLayers: myB?.regressionLayers || 0, defending: myB?.defending || false, stunned: myB?.stunned || false, pctBuffs: fmtBuffs(myB),
                                },
                                enemyActive: {
                                  name: enB?.monster?.localized?.zh?.name || defender?.localized?.zh?.name || "?",
                                  hp: enB?.currentHp ?? 100, maxHp: enB?.maxHp ?? 100,
                                  energy: enB?.energy ?? 10,
                                  burnLayers: enB?.burnLayers || 0, poisonLayers: enB?.poisonLayers || 0, freezeLayers: enB?.freezeLayers || 0,
                                  regressionLayers: enB?.regressionLayers || 0, defending: enB?.defending || false, stunned: enB?.stunned || false, pctBuffs: fmtBuffs(enB),
                                },
                                weather: b?.weather || "无", marks: (b?.marks || []).map((m: any) => m.name).join(" ") || "无",
                                history: fmtLog(b),
                                myTeamAlive: (b?.myTeam || team.map(t => ({monster:t.monster}))).filter((t: any) => t.isAlive !== false).map((t: any) => t.monster?.localized?.zh?.name || t.name || "?"),
                                enemyTeamAlive: (b?.enemyTeam || enemyTeam.map(e => ({monster:e}))).filter((t: any) => t.isAlive !== false).map((t: any) => t.monster?.localized?.zh?.name || t.name || "?"),
                                myMagicAvailable: teamMagicItem === "evolution_power" ? "进化之力" : teamMagicItem === "willpower_enhancement" ? "愿力强化" : "无",
                                mySkills: active?.selectedMoves && active.selectedMoves.length > 0 ? active.selectedMoves.map((mv: any) => `${mv.localized.zh.name}(${mv.energy_cost}费${mv.power||0}威)`).join(" ") : ((detailMap.get(active?.monster?.id || 0)?.move_pool || []) as Move[]).slice(0,4).map((mv: Move) => `${mv.localized.zh.name}(${mv.energy_cost}费${mv.power||0}威)`).join(" "),
                                enemySkills: ((detailMap.get(defender?.id || 0)?.move_pool || []) as Move[]).map((mv: Move) => `${mv.localized.zh.name}(${mv.energy_cost}费${mv.power||0}威)`).join(" "),
                                matchupTip: `${matchup?.pressure || "?"} | 我方${matchup?.aChecksB ? (matchup?.aCountersB ? "Counter" : "Check") : "✗"} | 敌方${matchup?.bChecksA ? (matchup?.bCountersA ? "Counter" : "Check") : "✗"}`,
                                ruleSuggestion: damageAnalysis.filter(d=>d.move.power).slice(0,2).map(d=>d.move.localized.zh.name+d.hpPercent.max+"%").join(" "),
                              };
                              getTurnAdvice(snap, { turnId: b?.turn || turnCount }).then(r => {
                                if (r === "__ABORTED__") { setAiLoading(false); return; }
                                saveAiAdvice(cleanMarkdown(r)); setAiLoading(false);
                              }).catch(() => { setAiAdvice("AI 请求失败"); setAiLoading(false); });
                            }}
                            disabled={aiLoading}
                            className="text-xs px-2 py-0.5 rounded border border-indigo-200 text-indigo-500 hover:bg-indigo-50 disabled:opacity-50"
                          >{aiLoading ? "分析中..." : "AI 分析"}</button>
                        )}
                      </div>
                    </div>
                    {/* AI 建议（AI 模式下显示） */}
                    {adviceMode === "ai" && battlePhase === "preloaded" && (
                      <div className="mb-2 shrink-0">
                        {/* 撤销提示条：A 方案 — 已移除被撤销的 AI 气泡，仅保留一行灰色横线 */}
                        {aiUndoNotice && (
                          <div className="text-xs text-zinc-400 px-2 py-1 mb-1.5 border-t border-b border-dashed border-zinc-200 bg-zinc-50/60 flex items-center gap-1.5">
                            <span className="text-zinc-300">↩</span>
                            <span>已撤销回合 {aiUndoNotice.targetTurn} 之后的 {aiUndoNotice.count} 条 AI 对话</span>
                          </div>
                        )}
                        {aiLoading && (
                          <div className="text-xs text-indigo-400 animate-pulse px-2 py-1.5 rounded bg-indigo-50/60 border border-indigo-100">
                            AI 分析中...
                          </div>
                        )}
                        {aiAdvice && !aiLoading && (
                          <div className="text-xs leading-relaxed space-y-1 px-2 py-1.5 rounded bg-indigo-50 border border-indigo-100 text-indigo-800">
                            {aiAdvice.split("\n").map((line, i) => (
                              <p key={i} className={line.startsWith("建议") ? "font-semibold text-sm" : "text-indigo-600"}>{line}</p>
                            ))}
                          </div>
                        )}
                        {/* AI 历史记录 */}
                        {aiHistory.length > 1 && (
                          <details className="text-xs text-zinc-400 mt-1">
                            <summary className="cursor-pointer hover:text-zinc-500">AI 对话历史 ({aiHistory.length} 条)</summary>
                            <div className="mt-1 space-y-1 max-h-40 overflow-y-auto">
                              {aiHistory.slice(1).map((h, i) => (
                                <div key={i} className="px-2 py-1 rounded bg-indigo-50/50 border border-indigo-50 text-indigo-600">
                                  {h.split("\n").filter(l => l.trim()).slice(0, 2).map((line, j) => (
                                    <p key={j} className={line.startsWith("建议") ? "font-semibold" : ""}>{line}</p>
                                  ))}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    )}
                    {/* 规则引擎（规则模式下始终显示，AI 模式无预加载时显示） */}
                    {(adviceMode === "rule" || battlePhase !== "preloaded") && (
                    <div className="flex-1 min-h-0 overflow-y-auto leading-relaxed space-y-1.5">
                      {battleSuggestions.map((s, i) => (
                        <div key={i} className={`px-2 py-1.5 rounded ${
                          i === 0 ? "text-sm font-bold"
                          : "text-xs"
                        } ${
                          s.type === "danger" ? "bg-red-50 text-red-700"
                          : s.type === "warn" ? "bg-amber-50 text-amber-700"
                          : s.type === "good" ? "bg-green-50 text-green-700"
                          : "bg-white/60 text-zinc-500"
                        }`}>
                          {s.type === "danger" && <span className="mr-1">⚡</span>}
                          {s.type === "warn" && <span className="mr-1">⚡</span>}
                          {s.type === "good" && <span className="mr-1">✓</span>}
                          {s.text}
                        </div>
                      ))}
                    </div>
                    )}
                  </div>
                </div>

                <div className="lg:col-span-2">
                {active && defender && speedComparison && matchup ? (
                  <MatchupAnalysis
                    matchup={matchup}
                    atkSpd={speedComparison.atkSpd}
                    defSpd={speedComparison.defSpd}
                    myDamage={damageAnalysis}
                    enemyDamage={reverseDamageAnalysis}
                    myTeam={team.map(m => ({ monster: m.monster, personality: m.personality, talent: m.talent, bloodline: m.bloodline }))}
                    enemyTeam={enemyTeam}
                    myActiveIndex={activeIndex}
                    enemyActiveIndex={enemyActiveIndex}
                    teamMagicItem={teamMagicItem}
                    onBattleStateChange={(b) => { currentBattleRef.current = b; }}
                    onUndoTurn={(targetTurn) => undoAIToTurn(targetTurn)}
                    onTurnExecuted={() => {
                      setTurnCount(prev => prev + 1);
                      const b = currentBattleRef.current;
                      if (battlePhase === "preloaded" && getApiKey() && b) {
                        setTimeout(() => {
                          setAiLoading(true); setAiAdvice("");
                          const myB = b.myTeam?.[b.myActive];
                          const enB = b.enemyTeam?.[b.enemyActive];
                          const snap = {
                            turn: b.turn || turnCount + 1,
                            myActive: { name: myB?.monster?.localized?.zh?.name || "?", hp: myB?.currentHp ?? 100, maxHp: myB?.maxHp ?? 100, energy: myB?.energy ?? 10, burnLayers: myB?.burnLayers || 0, poisonLayers: myB?.poisonLayers || 0, freezeLayers: myB?.freezeLayers || 0, regressionLayers: myB?.regressionLayers || 0, defending: myB?.defending || false, stunned: myB?.stunned || false, pctBuffs: fmtBuffs(myB) },
                            enemyActive: { name: enB?.monster?.localized?.zh?.name || "?", hp: enB?.currentHp ?? 100, maxHp: enB?.maxHp ?? 100, energy: enB?.energy ?? 10, burnLayers: enB?.burnLayers || 0, poisonLayers: enB?.poisonLayers || 0, freezeLayers: enB?.freezeLayers || 0, regressionLayers: enB?.regressionLayers || 0, defending: enB?.defending || false, stunned: enB?.stunned || false, pctBuffs: fmtBuffs(enB) },
                            weather: b.weather || "无", marks: (b.marks || []).map((m: any) => m.name).join(" ") || "无",
                            history: fmtLog(b),
                            myTeamAlive: (b.myTeam || []).filter((t: any) => t.isAlive !== false).map((t: any) => t.monster?.localized?.zh?.name || "?"),
                            enemyTeamAlive: (b.enemyTeam || []).filter((t: any) => t.isAlive !== false).map((t: any) => t.monster?.localized?.zh?.name || "?"),
                            myMagicAvailable: teamMagicItem === "evolution_power" ? "进化之力" : teamMagicItem === "willpower_enhancement" ? "愿力强化" : "无",
                            mySkills: active?.selectedMoves && active.selectedMoves.length > 0 ? active.selectedMoves.map((mv: any) => `${mv.localized.zh.name}(${mv.energy_cost}费${mv.power||0}威)`).join(" ") : ((detailMap.get(active?.monster?.id || 0)?.move_pool || []) as Move[]).slice(0,4).map((mv: Move) => `${mv.localized.zh.name}(${mv.energy_cost}费${mv.power||0}威)`).join(" "),
                            enemySkills: ((detailMap.get(defender?.id || 0)?.move_pool || []) as Move[]).map((mv: Move) => `${mv.localized.zh.name}(${mv.energy_cost}费${mv.power||0}威)`).join(" "),
                            matchupTip: `${matchup?.pressure || "?"} | 我方${matchup?.aChecksB ? (matchup?.aCountersB ? "Counter" : "Check") : "✗"} | 敌方${matchup?.bChecksA ? (matchup?.bCountersA ? "Counter" : "Check") : "✗"}`,
                            ruleSuggestion: damageAnalysis.filter(d=>d.move.power).slice(0,2).map(d=>d.move.localized.zh.name+d.hpPercent.max+"%").join(" "),
                          };
                          getTurnAdvice(snap, { turnId: b.turn || turnCount + 1 }).then(r => {
                            if (r === "__ABORTED__") { setAiLoading(false); return; }
                            saveAiAdvice(cleanMarkdown(r)); setAiLoading(false);
                          }).catch(() => setAiLoading(false));
                        }, 100);
                      }
                    }}
                  />
                ) : (
                  <div className="rounded-xl border border-amber-200 shadow-sm bg-amber-50/60 h-full flex items-center justify-center">
                    <p className="text-sm text-zinc-400">请选择我方精灵和对方精灵</p>
                  </div>
                )}
                </div>
              </div>
            </div>
          )}

          {page === "pokedex" && <Pokedex />}

          {page === "tutorial" && <Tutorial />}

          {page === "replay" && <ReplayAnalysis />}

          {page === "teams" && (
            <FeaturedTeams
              onImportMyTeam={(members) => {
                setTeam(members);
                setActiveIndex(0);
                setTeamImportTrigger({ members, ts: Date.now() });
                setPage("battle");
              }}
              onImportEnemyTeam={(monsters) => {
                setEnemyTeam(monsters);
                setEnemyActiveIndex(0);
                setPage("battle");
              }}
            />
          )}

          {page === "settings" && (
            <div className="max-w-lg mx-auto space-y-4">
              {/* 对战设置 */}
              <div className="bg-white rounded-xl border border-zinc-200 p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-zinc-800 mb-3">⚔️ 对战设置</h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-zinc-500 mb-1.5 block">建议模式</label>
                    <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-0.5 w-fit">
                      <button onClick={() => setAdviceMode("ai")} className={`text-xs px-4 py-1.5 rounded-md ${adviceMode === "ai" ? "bg-white text-zinc-800 shadow-sm font-medium" : "text-zinc-500"}`}>AI 建议</button>
                      <button onClick={() => setAdviceMode("rule")} className={`text-xs px-4 py-1.5 rounded-md ${adviceMode === "rule" ? "bg-white text-zinc-800 shadow-sm font-medium" : "text-zinc-500"}`}>规则引擎</button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1.5 block">段位模式</label>
                    <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-0.5 w-fit">
                      <button onClick={() => setRankMode("below_master")} className={`text-xs px-4 py-1.5 rounded-md ${rankMode === "below_master" ? "bg-white text-zinc-800 shadow-sm font-medium" : "text-zinc-500"}`}>大师以下</button>
                      <button onClick={() => setRankMode("master_plus")} className={`text-xs px-4 py-1.5 rounded-md ${rankMode === "master_plus" ? "bg-white text-zinc-800 shadow-sm font-medium" : "text-zinc-500"}`}>大师以上</button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 外观 */}
              <div className="bg-white rounded-xl border border-zinc-200 p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-zinc-800 mb-3">🎨 外观</h3>
                <div className="flex items-center gap-4 flex-wrap">
                  <div>
                    <label className="text-xs text-zinc-500 mb-1.5 block">主题</label>
                    <button onClick={() => setDarkMode(!darkMode)}
                      className={`text-xs px-4 py-1.5 rounded-lg border ${darkMode ? "bg-indigo-500 border-indigo-500 text-white" : "bg-zinc-100 border-zinc-200 text-zinc-600"}`}
                    >{darkMode ? "🌙 深色" : "☀️ 浅色"}</button>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1.5 block">字号</label>
                    <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-0.5">
                      {(["sm","md","lg"] as const).map(s => (
                        <button key={s} onClick={() => setFontSize(s)} className={`text-xs px-3 py-1.5 rounded-md ${fontSize===s?"bg-white text-zinc-800 shadow-sm font-medium":"text-zinc-500"}`}>{s==="sm"?"小":s==="md"?"中":"大"}</button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* AI 设置 */}
              <div className="bg-white rounded-xl border border-zinc-200 p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-zinc-800 mb-3">🤖 AI 设置</h3>
                <label className="text-xs text-zinc-500 mb-1.5 block">DeepSeek API Key</label>
                <div className="flex items-center gap-2">
                  <input type="password" value={aiKey}
                    onChange={(e) => { setAiKey(e.target.value); e.target.value.trim() ? setAiApiKey(e.target.value.trim()) : clearAiApiKey(); }}
                    placeholder="sk-..." className="flex-1 text-xs px-3 py-2 border border-zinc-300 rounded-lg outline-none focus:border-indigo-300" />
                </div>
                <p className="text-xs text-zinc-400 mt-1.5">用于 AI 对局建议和复盘分析。不填则使用规则引擎。</p>
              </div>

              {/* 数据管理 */}
              <div className="bg-white rounded-xl border border-zinc-200 p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-zinc-800 mb-3">💾 数据管理</h3>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => { if (confirm("清除所有 AI 对话历史？")) { setAiHistory([]); localStorage.removeItem("roco_ai_history"); } }}
                    className="text-xs px-3 py-1.5 rounded border border-zinc-200 text-zinc-500 hover:border-red-200 hover:text-red-500">清除 AI 历史</button>
                  <button onClick={() => { if (confirm("清除所有复盘记录？")) { localStorage.removeItem("roco_replays"); alert("已清除"); } }}
                    className="text-xs px-3 py-1.5 rounded border border-zinc-200 text-zinc-500 hover:border-red-200 hover:text-red-500">清除复盘记录</button>
                  <button onClick={() => { if (confirm("清除所有配队模板？")) { localStorage.removeItem("roco_team_templates"); alert("已清除"); } }}
                    className="text-xs px-3 py-1.5 rounded border border-zinc-200 text-zinc-500 hover:border-red-200 hover:text-red-500">清除配队模板</button>
                  <button onClick={() => { if (confirm("重置所有设置？AI Key 不会清除。")) { localStorage.clear(); setAiApiKey(aiKey); alert("已重置"); } }}
                    className="text-xs px-3 py-1.5 rounded border border-red-200 text-red-400 hover:bg-red-50">重置所有</button>
                </div>
              </div>

              {/* 版本信息 */}
              <div className="bg-white rounded-xl border border-zinc-200 p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-zinc-800 mb-3">📦 关于</h3>
                <div className="text-xs text-zinc-500 space-y-1">
                  <p className="font-medium text-zinc-700">洛克沙盘 v0.3.0</p>
                  <p>洛克王国：世界 PVP 对战辅助工具</p>
                  <p>
                    <a href="https://github.com/HZ-KMNO/roco-sandbox" target="_blank" rel="noopener noreferrer"
                      className="text-indigo-500 hover:text-indigo-600 underline">github.com/HZ-KMNO/roco-sandbox</a>
                  </p>
                  <p className="text-red-500 mt-2 leading-relaxed">
                    ⚠️ 禁止盗用，禁止商用。<br/>
                    本软件为免费开源项目，如您是通过付费渠道获得此软件，请举报商家并要求退款。
                  </p>
                  <button
                    onClick={async () => {
                      try {
                        setUpdateMsg("检查中...");
                        const msg = await invoke<string>("check_update");
                        setUpdateMsg(msg);
                      } catch (e) {
                        setUpdateMsg("检查更新需要桌面客户端");
                      }
                    }}
                    className="text-xs px-3 py-1.5 mt-2 rounded border border-indigo-200 text-indigo-500 hover:bg-indigo-50"
                  >检查更新</button>
                  {updateMsg && (
                    <div className="text-xs mt-1.5 space-y-1">
                      {updateMsg.split("\n").map((line, i) => {
                        const urlMatch = line.match(/下载地址:\s*(https?:\/\/\S+)/);
                        if (urlMatch) {
                          const dUrl = urlMatch[1];
                          return (
                            <button key={i}
                              onClick={async () => {
                                try {
                                  setUpdateMsg("正在下载更新...");
                                  const result = await invoke<string>("download_update", { url: dUrl });
                                  setUpdateMsg(result);
                                } catch (e) {
                                  setUpdateMsg("下载失败: " + String(e));
                                }
                              }}
                              className="inline-block px-3 py-1.5 rounded bg-indigo-500 text-white hover:bg-indigo-600 font-medium">
                              下载并安装新版本
                            </button>
                          );
                        }
                        return <p key={i} className={line.includes("最新版本") ? "text-green-600" : "text-indigo-600"}>{line}</p>;
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
