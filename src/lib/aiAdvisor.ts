/**
 * AI 对战建议系统（DeepSeek）
 *
 * 两阶段设计：
 * 1. preloadBattleContext() — 「开局」时调用，构建完整 System Prompt（会被 API 缓存）
 * 2. getTurnAdvice()       — 每回合调用，仅发送轻量回合快照
 */

import type { Monster, Move } from "./types";
import type { BattlerState } from "./simulator";
import type { MatchupResult } from "./battle";
import { analyzeMatchup } from "./battle";
import { calcStats, DEFAULT_TALENT } from "./calculator";
import type { Stats } from "./calculator";
import {
  startSession,
  appendTurn,
  buildMessages,
  resetSession,
  getCurrentSession,
} from "./aiSession";

const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const KEY = "deepseek_api_key_advisor";

export function getApiKey(): string | null { return localStorage.getItem(KEY); }
export function setApiKey(key: string) { localStorage.setItem(KEY, key); }
export function clearApiKey() { localStorage.removeItem(KEY); }

// ── 模块级状态：开局预注入的 System Prompt ──
let battleSystemPrompt: string | null = null;

// 当前在途请求的 AbortController（用于撤销时中断）
let activeAbortController: AbortController | null = null;

export function isBattlePreloaded(): boolean {
  return battleSystemPrompt !== null;
}

export function clearBattleContext(): void {
  battleSystemPrompt = null;
  resetSession();
  abortActiveRequest();
}

export function abortActiveRequest(): void {
  if (activeAbortController) {
    try { activeAbortController.abort(); } catch { /* noop */ }
    activeAbortController = null;
  }
}

// ── Type 中文映射 ──
const TYPE_ZH: Record<string, string> = {
  Normal: "普通", Grass: "草", Fire: "火", Water: "水",
  Light: "光", Electric: "电", Ground: "地", Ice: "冰",
  Poison: "毒", Bug: "虫", Fighting: "武", Dragon: "龙",
  Flying: "翼", Cute: "萌", Ghost: "幽", Dark: "恶",
  Mechanical: "机械", Illusion: "幻",
};
const CAT_ZH: Record<string, string> = {
  "Physical Attack": "物攻", "Magic Attack": "魔攻",
  "Defense": "防御", "Status": "状态",
};

function fmtType(t: { name: string; localized: { zh: string } } | null): string {
  if (!t) return "无";
  return TYPE_ZH[t.name] || t.localized.zh;
}

function fmtMove(m: Move): string {
  const cat = CAT_ZH[m.move_category] || m.move_category;
  const type = fmtType(m.move_type);
  const pwr = m.power ? `${m.power}威` : "--";
  return `${m.localized.zh.name}(${cat}/${type}/${m.energy_cost}费${pwr})`;
}

function fmtStatLine(s: Stats): string {
  return `HP${s.hp} 物攻${s.phyAtk} 魔攻${s.magAtk} 物防${s.phyDef} 魔防${s.magDef} 速度${s.spd}`;
}

// ── 队伍预注入（开局调用） ──
export function preloadBattleContext(
  myTeam: Monster[],
  enemyTeam: Monster[],
  matchupMatrix: Map<string, MatchupResult>,
  teamAnalysis: TeamAnalysis,
): string {
  const parts: string[] = [];

  parts.push("你是一个洛克王国：世界PVP对战教练。精通精灵PVP战术体系：对位博弈（Check/Counter）、场上与场下压力、集中施压战术、突破创造机会战术。");
  parts.push("");
  parts.push("## 游戏规则");
  parts.push("- 能量上限10，初始10。聚能（Focus）回复5能量，不攻击。");
  parts.push("- 剪刀石头布应对：防御克攻击(防御减伤70%)、攻击克状态(攻击伤害×2.5)、状态克防御(状态效果×2)。应对成功打断对手。");
  parts.push("- 印记永久在场，换人不消。光合(+1能)、润泽(减费)、叙事(+30%攻威,耗能+1)、蓄电(+10威)、龙噬(3费后双攻+30%)、中毒印记(3%毒伤)、降灵(-1能)、星陨(引爆)");
  parts.push("- 天气：雨天(水+75%)、暴风雪(+2冻结/回合)、沙暴(地系能耗减半)");
  parts.push("- 状态：灼烧(2%/层,换人消)、中毒(3%/层,换人消)、冰冻(5%/层冻结HP上限,不消)、萌化(退化形态/降六维)");
  parts.push("- 换人清除灼烧/中毒/百分比增益/能力阶段，但保留印记和冰冻。");
  parts.push("- 迅捷：翼系主动换入时立即释放第一个迅捷技能（需要能量）。");
  parts.push("- 首领化：每场1次，提升六维改变特性。");
  parts.push("- 愿力冲击：2费100威（应对状态→250威，+150%），每场2次3回合CD。");
  parts.push("- 费用基准：0费40威 1费60威 2费80威 3费100威 4费125威 5费140威");
  parts.push("");
  parts.push("## 你的任务");
  parts.push("根据当前回合的战场信息，给出最优操作建议。格式：");
  parts.push("建议：xxx");
  parts.push("理由：xxx");
  parts.push("");

  // ── 我方队伍 ──
  parts.push("## 我方队伍");
  for (const m of myTeam) {
    const stats = calcStats(m, { id: 0, name: "Neutral", localized: { zh: "平衡" },
      hp_mod_pct: 0, phy_atk_mod_pct: 0, mag_atk_mod_pct: 0,
      phy_def_mod_pct: 0, mag_def_mod_pct: 0, spd_mod_pct: 0 }, DEFAULT_TALENT);
    const detail = m as any;
    const moves = (detail.move_pool || []) as Move[];
    const topMoves = moves.slice(0, 6).map(fmtMove).join("；");
    const traitText = detail.trait
      ? `${detail.trait.localized.zh.name}：${detail.trait.localized.zh.description}`
      : "无";
    const types = m.sub_type
      ? `${fmtType(m.main_type)}/${fmtType(m.sub_type)}`
      : fmtType(m.main_type);
    parts.push(`- ${m.localized.zh.name}(${types}) ${fmtStatLine(stats)}`);
    parts.push(`  特性: ${traitText}`);
    parts.push(`  技能: ${topMoves}`);
  }

  // ── 对方队伍 ──
  parts.push("");
  parts.push("## 对方队伍");
  for (const m of enemyTeam) {
    const stats = calcStats(m, { id: 0, name: "Neutral", localized: { zh: "平衡" },
      hp_mod_pct: 0, phy_atk_mod_pct: 0, mag_atk_mod_pct: 0,
      phy_def_mod_pct: 0, mag_def_mod_pct: 0, spd_mod_pct: 0 }, DEFAULT_TALENT);
    const detail = m as any;
    const traitText = detail.trait
      ? `${detail.trait.localized.zh.name}：${detail.trait.localized.zh.description}`
      : "无";
    const types = m.sub_type
      ? `${fmtType(m.main_type)}/${fmtType(m.sub_type)}`
      : fmtType(m.main_type);
    parts.push(`- ${m.localized.zh.name}(${types}) ${fmtStatLine(stats)} 特性: ${traitText}`);
  }

  // ── 预计算对位矩阵（仅包含关键信息） ──
  parts.push("");
  parts.push("## 对位矩阵（预计算）");
  parts.push("格式：我方A→对方B: 速度(先/后) Check/Counter 最优技能(伤害%) KOT N回合");
  for (const [key, mr] of matchupMatrix) {
    const speed = mr.speedWinner === "a" ? "先"
      : mr.speedWinner === "b" ? "后" : "同";
    const check = mr.aChecksB
      ? (mr.aCountersB ? "Counter✓" : "Check✓")
      : "✗";
    const best = mr.aBestMove
      ? `${mr.aBestMove.move.localized.zh.name}(${mr.aBestMove.hpPercent.max}%)`
      : "N/A";
    const ko = mr.aKoTurns === Infinity ? "∞" : `${mr.aKoTurns}T`;
    parts.push(`- ${key}: ${speed} ${check} ${best} KO${ko}`);
  }

  // ── 队伍分析 ──
  parts.push("");
  parts.push("## 队伍分析");
  parts.push(`- 属性覆盖: ${teamAnalysis.coverage}`);
  parts.push(`- 核心威胁: ${teamAnalysis.threats}`);
  parts.push(`- 战术建议: ${teamAnalysis.strategy}`);
  if (teamAnalysis.redundancyChains) {
    parts.push(`- 克制联动: ${teamAnalysis.redundancyChains}`);
  }

  battleSystemPrompt = parts.join("\n");
  // 启动新会话（清掉旧的 session，preload 永不撤销）
  startSession(battleSystemPrompt);
  return battleSystemPrompt;
}

// ── 回合快照（每回合调用） ──
export interface TurnSnapshot {
  turn: number;
  myActive: {
    name: string;
    hp: number; maxHp: number;
    energy: number;
    burnLayers: number; poisonLayers: number; freezeLayers: number;
    regressionLayers: number;
    defending: boolean;
    stunned: boolean;
    pctBuffs: string;
  };
  enemyActive: {
    name: string;
    hp: number; maxHp: number;
    energy: number;
    burnLayers: number; poisonLayers: number; freezeLayers: number;
    regressionLayers: number;
    defending: boolean;
    stunned: boolean;
    pctBuffs: string;
  };
  weather: string;
  marks: string;
  history: { turn: number; myMove: string; enemyMove: string }[];
  myTeamAlive: string[];
  enemyTeamAlive: string[];
  myMagicAvailable: string;
  mySkills: string;
  enemySkills: string;
  matchupTip: string;
  ruleSuggestion: string;
}

function buildTurnPrompt(snap: TurnSnapshot): string {
  const m = snap.myActive;
  const e = snap.enemyActive;
  const statusStr = (s: typeof m) =>
    [
      s.burnLayers ? `灼烧${s.burnLayers}` : "",
      s.poisonLayers ? `中毒${s.poisonLayers}` : "",
      s.freezeLayers ? `冰冻${s.freezeLayers}` : "",
      s.regressionLayers ? `萌化${s.regressionLayers}` : "",
      s.defending ? "防御中" : "",
      s.stunned ? "眩晕" : "",
      s.pctBuffs ? `增益:${s.pctBuffs}` : "",
    ].filter(Boolean).join(" ") || "无";

  const lines = [
    `回合${snap.turn}`,
    "",
    `我方: ${m.name} HP${m.hp}/${m.maxHp} 能量${m.energy}/10 [${statusStr(m)}]`,
    `我方技能: ${snap.mySkills}`,
    `敌方: ${e.name} HP${e.hp}/${e.maxHp} 能量${e.energy}/10 [${statusStr(e)}]`,
    `敌方技能: ${snap.enemySkills}`,
    `天气: ${snap.weather}  印记: ${snap.marks}`,
    `我方存活: ${snap.myTeamAlive.join("、")}`,
    `敌方存活: ${snap.enemyTeamAlive.join("、")}`,
    `魔法: ${snap.myMagicAvailable}`,
  ];

  if (snap.history.length > 0) {
    lines.push("近期: " + snap.history.map(h =>
      `T${h.turn}:我${h.myMove}/敌${h.enemyMove}`
    ).join(" → "));
  }

  lines.push(`数据: ${snap.matchupTip}`);
  lines.push(`规则引擎建议: ${snap.ruleSuggestion}`);

  return lines.join("\n");
}

// ── API 调用（多轮对话版） ──
//
// 第一次调用（turnId=1）会送 [system, user_R1]
// 第二次调用（turnId=2）送 [system, user_R1, assist_R1, user_R2]
// 撤销到 R3 后再调用：buildMessages 已自动裁掉 turnId>=3 的对，AI 看不到撤销内容
//
// turnId 缺省时表示"快速一次性查询"，不写入 session（保留原行为兼容）
export async function getTurnAdvice(
  snap: TurnSnapshot,
  opts?: { turnId?: number; battleStateHash?: string },
): Promise<string> {
  const key = getApiKey();
  if (!key) return "";

  const userPrompt = buildTurnPrompt(snap);
  const session = getCurrentSession();

  // 拼装 messages：有 session 用多轮对话，否则降级单轮
  let messages: { role: "system" | "user" | "assistant"; content: string }[];
  if (session) {
    messages = buildMessages();
    messages.push({ role: "user", content: userPrompt });
  } else {
    const systemPrompt = battleSystemPrompt || getFallbackSystemPrompt();
    messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];
  }

  // 中断上一个未完成请求（撤销/重试场景）
  abortActiveRequest();
  const ctrl = new AbortController();
  activeAbortController = ctrl;

  try {
    const resp = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        max_tokens: 300,
        messages,
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) return "";
    const data = await resp.json();
    const reply: string = data.choices?.[0]?.message?.content || "";

    // 写回 session（仅当 opts.turnId 提供时入历史）
    if (reply && opts?.turnId !== undefined && session) {
      appendTurn(opts.turnId, userPrompt, reply, opts.battleStateHash);
    }
    return reply;
  } catch (err: any) {
    if (err?.name === "AbortError") return "__ABORTED__";
    return "";
  } finally {
    if (activeAbortController === ctrl) activeAbortController = null;
  }
}

// 降级 System Prompt（开局前或未预加载时使用）
function getFallbackSystemPrompt(): string {
  return `你是洛克王国：世界PVP对战的教练。精通Check/Counter对位博弈、集中施压与突破战术。
规则：能量上限10，剪刀石头布应对（防御克攻击、攻击克状态、状态克防御）。
印记永久在场，换人不消。灼烧/中毒换人消，冰冻不消。
费用基准：0费40威 1费60威 2费80威 3费100威 4费125威 5费140威。
格式（纯文本，不要用markdown）：\\n建议：xxx\\n理由：xxx`;
}

// ── 队伍分析类型 ──
export interface TeamAnalysis {
  coverage: string;
  threats: string;
  strategy: string;
  redundancyChains?: string;
}

/**
 * 构建预计算对位矩阵和队伍分析。
 * 在「开局」前调用，用于 preloadBattleContext。
 */
export function buildTeamAnalysis(
  myTeam: Monster[],
  enemyTeam: Monster[],
  detailMap: Map<number, Monster>,
): { matrix: Map<string, MatchupResult>; analysis: TeamAnalysis } {
  const matrix = new Map<string, MatchupResult>();
  const neutralPersonality = {
    id: 0, name: "Neutral", localized: { zh: "平衡" },
    hp_mod_pct: 0, phy_atk_mod_pct: 0, mag_atk_mod_pct: 0,
    phy_def_mod_pct: 0, mag_def_mod_pct: 0, spd_mod_pct: 0,
  };

  for (const myM of myTeam) {
    const myStats = calcStats(myM, neutralPersonality, DEFAULT_TALENT);
    const myDetail = detailMap.get(myM.id);
    const myMoves = (myDetail?.move_pool || []) as Move[];

    for (const enM of enemyTeam) {
      const enStats = calcStats(enM, neutralPersonality, DEFAULT_TALENT);
      const enDetail = detailMap.get(enM.id);
      const enMoves = (enDetail?.move_pool || []) as Move[];

      const mr = analyzeMatchup(myM, enM, myStats, enStats, myMoves, enMoves);
      const key = `${myM.localized.zh.name}→${enM.localized.zh.name}`;
      matrix.set(key, mr);
    }
  }

  // Team coverage analysis
  const coverageParts: string[] = [];
  const threatParts: string[] = [];
  let coverageScore = 0;
  let weaknessScore = 0;

  for (const enM of enemyTeam) {
    const eTypes = [enM.main_type.name];
    if (enM.sub_type) eTypes.push(enM.sub_type.name);

    const counters = myTeam.filter(myM => {
      const myDetail = detailMap.get(myM.id);
      const myMoves = (myDetail?.move_pool || []) as Move[];
      return myMoves.some(mv => {
        if (!mv.move_type) return false;
        return eTypes.some(et => {
          const eff = getSimpleEff(mv.move_type!.name, et);
          return eff > 1;
        });
      });
    });

    if (counters.length > 0) {
      coverageScore++;
      coverageParts.push(`${enM.localized.zh.name}←${counters.map(c => c.localized.zh.name).join("/")}`);
    } else {
      weaknessScore++;
      threatParts.push(`${enM.localized.zh.name}(无对策)`);
    }
  }

  // Also check threats: which enemies threaten my team
  for (const myM of myTeam) {
    const myTypes = [myM.main_type.name];
    if (myM.sub_type) myTypes.push(myM.sub_type.name);

    const dangerous = enemyTeam.filter(enM => {
      const enDetail = detailMap.get(enM.id);
      const enMoves = (enDetail?.move_pool || []) as Move[];
      return enMoves.some(mv => {
        if (!mv.move_type) return false;
        return myTypes.some(mt => {
          const eff = getSimpleEff(mv.move_type!.name, mt);
          return eff > 1;
        });
      });
    });
    if (dangerous.length > 0) {
      threatParts.push(`${myM.localized.zh.name}被${dangerous.map(d => d.localized.zh.name).join("/")}克制`);
    }
  }

  // Strategy recommendation
  let strategy = "均衡对局，根据场上情况灵活应对。";
  const totalEnemies = enemyTeam.length;
  const covPct = totalEnemies > 0 ? coverageScore / totalEnemies : 0;
  if (covPct >= 0.8) {
    strategy = `属性优势明显（克制${coverageScore}/${totalEnemies}），可积极进攻施压，用集中施压持续打击对方防守弱点。`;
  } else if (covPct >= 0.5) {
    strategy = `属性基本覆盖（克制${coverageScore}/${totalEnemies}），注意保护被克制的精灵，寻找机会让克制精灵安全上场。`;
  } else {
    strategy = `属性劣势（仅克制${coverageScore}/${totalEnemies}），需要创造机会战术（炮台反复上场/捕获关键目标），优先消除最大威胁。`;
  }

  const analysis: TeamAnalysis = {
    coverage: `克制${coverageScore}/${totalEnemies}: ${coverageParts.join("; ")}`,
    threats: threatParts.length > 0 ? threatParts.join("; ") : "无明显威胁",
    strategy,
    redundancyChains: coverageParts.length > 0 ? coverageParts.join("; ") : undefined,
  };

  return { matrix, analysis };
}

// 简易属性克制计算（本地用）
function getSimpleEff(atkType: string, defType: string): number {
  const chart: Record<string, string[]> = {
    Normal: [],
    Grass: ["Water", "Ground"],
    Fire: ["Grass", "Ice", "Bug", "Mechanical"],
    Water: ["Fire", "Ground"],
    Light: ["Ghost", "Dark"],
    Electric: ["Water", "Flying"],
    Ground: ["Fire", "Electric", "Poison", "Mechanical"],
    Ice: ["Grass", "Ground", "Flying", "Dragon"],
    Poison: ["Grass", "Cute"],
    Bug: ["Grass", "Dark", "Illusion"],
    Fighting: ["Normal", "Ice", "Dark", "Mechanical"],
    Dragon: ["Dragon"],
    Flying: ["Grass", "Fighting", "Bug"],
    Cute: ["Fighting", "Dragon"],
    Ghost: ["Ghost", "Illusion"],
    Dark: ["Ghost", "Illusion"],
    Mechanical: ["Ice", "Cute", "Illusion"],
    Illusion: ["Fighting", "Cute"],
  };
  const strong = chart[atkType] || [];
  return strong.includes(defType) ? 2 : 1;
}

// ── 兼容旧接口 ──
export interface AdvisorContext {
  myMonster: Monster; myBattler: BattlerState; myMoves: Move[];
  enemyMonster: Monster; enemyBattler: BattlerState; enemyMoves: Move[];
  mySpd: number; enemySpd: number;
  pressure: string; aChecksB: boolean; aCountersB: boolean;
  bChecksA: boolean; bCountersA: boolean;
  damageInfo: string; enemyDamageInfo: string;
  weather: string; marks: string;
  myTeamAlive: string; enemyTeamAlive: string;
  myMagicAvailable: string;
  turn: number;
}

export async function getAIAdvice(ctx: AdvisorContext): Promise<string> {
  // 转换旧接口到新的 TurnSnapshot
  const snap: TurnSnapshot = {
    turn: ctx.turn,
    myActive: {
      name: ctx.myMonster.localized.zh.name,
      hp: ctx.myBattler.currentHp ?? ctx.myBattler.maxHp,
      maxHp: ctx.myBattler.maxHp,
      energy: ctx.myBattler.energy,
      burnLayers: ctx.myBattler.burnLayers || 0,
      poisonLayers: ctx.myBattler.poisonLayers || 0,
      freezeLayers: ctx.myBattler.freezeLayers || 0,
      regressionLayers: (ctx.myBattler as any).regressionLayers || 0,
      defending: ctx.myBattler.defending || false,
      stunned: false,
      pctBuffs: "",
    },
    enemyActive: {
      name: ctx.enemyMonster.localized.zh.name,
      hp: ctx.enemyBattler.currentHp ?? ctx.enemyBattler.maxHp,
      maxHp: ctx.enemyBattler.maxHp,
      energy: ctx.enemyBattler.energy,
      burnLayers: ctx.enemyBattler.burnLayers || 0,
      poisonLayers: ctx.enemyBattler.poisonLayers || 0,
      freezeLayers: ctx.enemyBattler.freezeLayers || 0,
      regressionLayers: (ctx.enemyBattler as any).regressionLayers || 0,
      defending: ctx.enemyBattler.defending || false,
      stunned: false,
      pctBuffs: "",
    },
    weather: ctx.weather,
    marks: ctx.marks,
    history: [],
    myTeamAlive: ctx.myTeamAlive.split("、").filter(Boolean),
    enemyTeamAlive: ctx.enemyTeamAlive.split("、").filter(Boolean),
    myMagicAvailable: ctx.myMagicAvailable,
    mySkills: ctx.myMoves.map(mv => `${mv.localized.zh.name}(${mv.energy_cost}费${mv.power||0}威)`).join(" "),
    enemySkills: ctx.enemyMoves.map(mv => `${mv.localized.zh.name}(${mv.energy_cost}费${mv.power||0}威)`).join(" "),
    matchupTip: `${ctx.pressure} | 我方${ctx.aChecksB ? (ctx.aCountersB ? "Counter" : "Check") : "不利"} | 敌方${ctx.bChecksA ? (ctx.bCountersA ? "Counter" : "Check") : "不利"}`,
    ruleSuggestion: ctx.damageInfo,
  };
  return getTurnAdvice(snap);
}
