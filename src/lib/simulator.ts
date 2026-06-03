import type { Monster, Move, TypeInfo, Personality } from "./types";
import { calcStats, getTypeEffectiveness, calcDamage } from "./calculator";
import type { Stats, Talent } from "./calculator";
import { DEFAULT_TALENT } from "./calculator";
import { getPopularPersonality, getPopularTalent } from "./popularStats";
import typesData from "../data/types.json";
import evolutionData from "../data/evolution_chains.json";
import monstersDetail from "../data/monsters_detail.json";

const evoPrevMap = evolutionData.prevMap as Record<string, number>;
const evoDetailMap = new Map((monstersDetail as Monster[]).map((m) => [m.id, m]));
const detailMap2 = new Map((monstersDetail as Monster[]).map((m) => [m.id, m]));
import movesData from "../data/moves.json";

const types = typesData as TypeInfo[];
const moves = movesData as Move[];
const WILLPOWER_BASE = moves.find((m) => m.id === 2) as Move | undefined;

export type MagicItemId = "evolution_power" | "willpower_enhancement";

export interface MagicItemDef {
  id: MagicItemId;
  zh: string;
  desc: string;
  maxUses: number;
  cooldown: number;
}

export const MAGIC_ITEMS: MagicItemDef[] = [
  { id: "evolution_power", zh: "进化之力", desc: "首领血脉精灵进化为首领形态", maxUses: 1, cooldown: 0 },
  { id: "willpower_enhancement", zh: "愿力强化", desc: "第1技能替换为愿力冲击（血脉属性）", maxUses: Infinity, cooldown: 3 },
];

export interface StatStages {
  phyAtk: number;
  magAtk: number;
  phyDef: number;
  magDef: number;
  spd: number;
}

export interface PctBuffs {
  phyAtk: number;
  magAtk: number;
  phyDef: number;
  magDef: number;
  spd: number;
}

export type MoveEffect =
  | { type: "burn"; layers: number }
  | { type: "freeze"; layers: number }
  | { type: "poison"; layers: number }
  | { type: "statUp"; stat: keyof StatStages; stages: number }
  | { type: "statDown"; stat: keyof StatStages; stages: number }
  | { type: "pctBuff"; stat: keyof StatStages; value: number }
  | { type: "applyMark"; mark: MarkName; layers: number; onSelf: boolean }
  | { type: "heal"; percent: number }
  | { type: "recoverEnergy"; amount: number }
  | { type: "lifesteal"; percent: number }
  | { type: "comboMod"; amount: number; onSelf: boolean }
  | { type: "setWeather"; weather: Weather }
  | { type: "interrupt" }
  | { type: "dispelMarks" }
  | { type: "stun" }
  | { type: "regress"; layers: number }
  | { type: "randomSkill"; kind: "rewrite" | "borrow" | "steal" }
  | { type: "teamShift" };

const STAT_KEY_ZH: Record<string, string> = {
  phyAtk: "物攻", magAtk: "魔攻", phyDef: "物防", magDef: "魔防", spd: "速度",
};

export function parseMoveEffects(move: Move | null): MoveEffect[] {
  if (!move) return [];
  const desc = move.localized.zh.description;
  if (!desc) return [];
  const effects: MoveEffect[] = [];

  // Status layers: "获得10层灼烧"
  const statusMatch = desc.match(/获得(\d+)层(灼烧|中毒|冰冻)/);
  if (statusMatch) {
    const layers = parseInt(statusMatch[1]);
    const statusType = statusMatch[2];
    if (statusType === "灼烧") effects.push({ type: "burn", layers });
    if (statusType === "中毒") effects.push({ type: "poison", layers });
    if (statusType === "冰冻") effects.push({ type: "freeze", layers });
  }

  // Mark application: "获得2层星陨印记", "敌方获得1层湿润印记"
  const markNames: Record<string, MarkName> = {
    "光合": "photosynthesis", "湿润": "moisture", "蓄势": "narrative", "蓄电": "charge",
    "龙噬": "dragon", "中毒印记": "poison", "降灵": "spirit", "星陨": "starfall",
  };
  const markMatch = desc.match(/(敌方|自己)?获得(\d+)层(光合|湿润|蓄势|蓄电|龙噬|中毒|降灵|星陨)印记/);
  if (markMatch) {
    const onSelf = markMatch[1] === "自己" || !markMatch[1];
    const layers = parseInt(markMatch[2]);
    const markName = markNames[markMatch[3]];
    if (markName) effects.push({ type: "applyMark", mark: markName, layers, onSelf });
  }

  // Percentage buffs: "获得物攻+70%", "获得双攻+30%", "获得攻防速+20%", "双防-70%"
  const gainPct = desc.match(/获得(物攻|魔攻|物防|魔防|速度|双攻|双防|攻防速)([+\-])(\d+)%/);
  if (gainPct) {
    const rawStat = gainPct[1];
    const sign = gainPct[2] === "+" ? 1 : -1;
    const val = parseInt(gainPct[3]) * sign;
    if (rawStat === "双攻") {
      effects.push({ type: "pctBuff", stat: "phyAtk", value: val });
      effects.push({ type: "pctBuff", stat: "magAtk", value: val });
    } else if (rawStat === "双防") {
      effects.push({ type: "pctBuff", stat: "phyDef", value: val });
      effects.push({ type: "pctBuff", stat: "magDef", value: val });
    } else if (rawStat === "攻防速") {
      effects.push({ type: "pctBuff", stat: "phyAtk", value: val });
      effects.push({ type: "pctBuff", stat: "magAtk", value: val });
      effects.push({ type: "pctBuff", stat: "phyDef", value: val });
      effects.push({ type: "pctBuff", stat: "magDef", value: val });
      effects.push({ type: "pctBuff", stat: "spd", value: val });
    } else {
      const statMap: Record<string, keyof StatStages> = {
        "物攻": "phyAtk", "魔攻": "magAtk", "物防": "phyDef", "魔防": "magDef", "速度": "spd",
      };
      const stat = statMap[rawStat];
      if (stat) effects.push({ type: "pctBuff", stat, value: val });
    }
  }

  // Energy recovery: "自己回复5能量" / "为场下每个精灵回复3能量"
  const energyMatch = desc.match(/回复(\d+)能量/);
  if (energyMatch && !desc.includes("场下")) {
    effects.push({ type: "recoverEnergy", amount: parseInt(energyMatch[1]) });
  }

  // Lifesteal: "获得100%吸血" / "获得50%吸血"
  const lsMatch = desc.match(/获得(\d+)%吸血/);
  if (lsMatch) {
    effects.push({ type: "lifesteal", percent: parseInt(lsMatch[1]) });
  }

  // Combo modifier: "获得连击数+3" / "敌方获得连击数-3"
  const comboMatch = desc.match(/(敌方|自己)?获得连击数([+\-]\d+)/);
  if (comboMatch) {
    const isSelf = comboMatch[1] !== "敌方";
    const amount = parseInt(comboMatch[2]);
    effects.push({ type: "comboMod", amount, onSelf: isSelf });
  }

  // HP recovery: "自己回复30%生命" / "自己回复15%生命和4能量"
  const healMatch = desc.match(/回复(\d+)%生命/);
  if (healMatch) {
    effects.push({ type: "heal", percent: parseInt(healMatch[1]) });
  }

  // Regression: "获得1层萌化" / "敌方获得萌化"
  const regMatch = desc.match(/获得(\d+)层萌化/);
  if (regMatch) effects.push({ type: "regress", layers: parseInt(regMatch[1]) });
  else if (desc.includes("获得萌化")) effects.push({ type: "regress", layers: 1 });

  // Stun: "敌方获得眩晕" / "敌方下回合获得眩晕"
  if (desc.includes("获得眩晕") || desc.includes("下回合获得眩晕")) {
    effects.push({ type: "stun" });
  }

  // Mark dispel: "驱散敌方所有印记" / "驱散双方所有印记"
  if (desc.includes("驱散") && desc.includes("印记")) {
    effects.push({ type: "dispelMarks" });
  }

  // Interrupt: "打断" in counter context
  if (desc.includes("应对") && desc.includes("打断")) {
    effects.push({ type: "interrupt" });
  }

  // Weather change: "将天气改为雨天" / "将天气改为沙暴" / "将天气改为暴风雪"
  const weatherMatch = desc.match(/将天气改为(雨天|沙暴|暴风雪)/);
  if (weatherMatch) {
    const wMap: Record<string, Weather> = { "雨天": "rain", "沙暴": "sandstorm", "暴风雪": "blizzard" };
    effects.push({ type: "setWeather", weather: wMap[weatherMatch[1]] || null });
  }

  // Random skill: 复写 / 借用 / 取念
  if (desc.includes("随机变成自己未携带的技能")) {
    effects.push({ type: "randomSkill", kind: "rewrite" });
  } else if (desc.includes("随机变成己方队伍中其他精灵的技能")) {
    effects.push({ type: "randomSkill", kind: "borrow" });
  } else if (desc.includes("随机变成敌方任意精灵的技能")) {
    effects.push({ type: "randomSkill", kind: "steal" });
  }

  // 过山车: team-wide transmission
  if (desc.includes("跨精灵向下移动") || (move.localized.zh.name === "过山车")) {
    effects.push({ type: "teamShift" });
  }

  return effects;
}

export function isRandomSkill(move: Move): boolean {
  const desc = move.localized?.zh?.description || move.description || "";
  return desc.includes("随机变成自己未携带") ||
    desc.includes("随机变成己方队伍中其他精灵") ||
    desc.includes("随机变成敌方任意精灵");
}

export function getRandomSkillKind(move: Move): "rewrite" | "borrow" | "steal" | null {
  const desc = move.localized?.zh?.description || move.description || "";
  if (desc.includes("随机变成自己未携带的技能")) return "rewrite";
  if (desc.includes("随机变成己方队伍中其他精灵的技能")) return "borrow";
  if (desc.includes("随机变成敌方任意精灵的技能")) return "steal";
  return null;
}

// Check if monster has 盲从 trait (帅帅魔偶)
function hasBlindObey(monster: Monster): boolean {
  return monster.trait?.name === "盲从" ||
    monster.trait?.localized?.zh?.name === "盲从";
}

// Check if monster has 狂欢开始 trait (机幕方舟)
function hasCarnivalStart(monster: Monster): boolean {
  return monster.trait?.name === "狂欢开始" ||
    monster.trait?.localized?.zh?.name === "狂欢开始";
}

// Get random skill cost reduction from 盲从 trait
function getBlindObeyCostReduction(monster: Monster, move: Move): number {
  if (!hasBlindObey(monster)) return 0;
  if (!move.move_type) return 0;
  // 非幻系 skills cost -2
  if (move.move_type.name !== "Illusion") return 2;
  return 0;
}

/**
 * Resolve random skills at turn start.
 * 复写: transform into a skill not currently in the battler's moveSlots
 * 借用: transform into a random skill from teammates
 * 取念: transform into a random skill from enemy team
 */
function resolveRandomSkills(
  myBattler: BattlerState, enemyBattler: BattlerState,
  myTeam: BattlerState[], enemyTeam: BattlerState[],
): void {
  const allBattlers = [myBattler, enemyBattler];

  for (const battler of allBattlers) {
    for (let i = 0; i < battler.moveSlots.length; i++) {
      const slot = battler.moveSlots[i];
      if (!isRandomSkill(slot)) continue;
      const kind = getRandomSkillKind(slot);
      if (!kind) continue;

      let newMove: Move | null = null;

      if (kind === "rewrite") {
        // 复写: 变成自己未携带的技能，能耗-2
        const existingIds = new Set(battler.moveSlots.map(m => m.id));
        const candidates = moves.filter(m => m.power && !existingIds.has(m.id));
        if (candidates.length > 0) {
          newMove = candidates[Math.floor(Math.random() * candidates.length)];
          if (newMove) {
            newMove = {
              ...newMove,
              energy_cost: Math.max(0, newMove.energy_cost - 2),
              localized: {
                ...newMove.localized,
                zh: {
                  ...newMove.localized.zh,
                  name: `${newMove.localized.zh.name}(复写)`,
                },
              },
            };
          }
        }
      } else if (kind === "borrow") {
        // 借用: 变成己方队伍中其他精灵的技能（含空栏位）
        const candidates: Move[] = [];
        for (const teammate of myTeam) {
          if (teammate === battler) continue;
          // Also consider "空栏位" as a possible borrow target
          for (const tm of teammate.moveSlots) {
            candidates.push(tm);
          }
          // If teammate has less than 4 skills, empty slots are also candidates
          // Represent empty slot as a "normal" move (like 撞击)
          if (teammate.moveSlots.length < 4) {
            const basicMove = moves.find(m => m.id === 1); // Focus/聚能 equivalent
            if (basicMove) candidates.push(basicMove);
          }
        }
        if (candidates.length > 0) {
          newMove = candidates[Math.floor(Math.random() * candidates.length)];
          if (newMove) {
            newMove = {
              ...newMove,
              localized: {
                ...newMove.localized,
                zh: {
                  ...newMove.localized.zh,
                  name: `${newMove.localized.zh.name}(借用)`,
                },
              },
            };
          }
        }
      } else if (kind === "steal") {
        // 取念: 变成敌方任意精灵的技能，能耗-2
        const candidates: Move[] = [];
        for (const enemy of enemyTeam) {
          for (const em of enemy.moveSlots) {
            candidates.push(em);
          }
        }
        if (candidates.length > 0) {
          newMove = candidates[Math.floor(Math.random() * candidates.length)];
          if (newMove) {
            newMove = {
              ...newMove,
              energy_cost: Math.max(0, newMove.energy_cost - 2),
              localized: {
                ...newMove.localized,
                zh: {
                  ...newMove.localized.zh,
                  name: `${newMove.localized.zh.name}(取念)`,
                },
              },
            };
          }
        }
      }

      if (newMove) {
        battler.moveSlots[i] = newMove;
      }
    }
  }
}

/**
 * 过山车: team-wide cross-monster transmission.
 * Shift all skills across ALL team members down by 1 position.
 */
function applyTeamShift(team: BattlerState[]): void {
  // Collect all moves into a flat list
  const allMoves: { move: Move; battlerIdx: number; slotIdx: number }[] = [];
  for (let bi = 0; bi < team.length; bi++) {
    for (let si = 0; si < team[bi].moveSlots.length; si++) {
      allMoves.push({ move: team[bi].moveSlots[si], battlerIdx: bi, slotIdx: si });
    }
  }
  if (allMoves.length === 0) return;

  // Shift all down by 1 (环形)
  const lastMove = allMoves[allMoves.length - 1].move;
  for (let i = allMoves.length - 1; i > 0; i--) {
    allMoves[i].move = allMoves[i - 1].move;
  }
  allMoves[0].move = lastMove;

  // Write back: rebuild each battler's moveSlots
  // First clear all
  for (const b of team) b.moveSlots = [];
  // Then redistribute
  for (const entry of allMoves) {
    team[entry.battlerIdx].moveSlots.push(entry.move);
  }
}

export function getTransmissionValue(move: Move): number {
  const desc = move.localized?.zh?.description || move.description || "";
  const match = desc.match(/传动(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

export function getSlotBonus(move: Move, slotIndex: number): { powerBonus: number; costReduction: number } {
  const desc = move.localized?.zh?.description || move.description || "";
  const slot = slotIndex + 1;
  let powerBonus = 0;
  let costReduction = 0;

  const powerMatch = desc.match(/本技能位于(\d+)号位时威力\+(\d+)/);
  if (powerMatch && parseInt(powerMatch[1]) === slot) {
    powerBonus += parseInt(powerMatch[2]);
  }
  const powerMultiMatch = desc.match(/位于(\d+)号或(\d+)号位时威力\+(\d+)/);
  if (powerMultiMatch && (parseInt(powerMultiMatch[1]) === slot || parseInt(powerMultiMatch[2]) === slot)) {
    powerBonus += parseInt(powerMultiMatch[3]);
  }
  const costMatch = desc.match(/位于(\d+)号或(\d+)号位时.*?能耗-(\d+)/);
  if (costMatch && (parseInt(costMatch[1]) === slot || parseInt(costMatch[2]) === slot)) {
    costReduction += parseInt(costMatch[3]);
  }
  const costSingleMatch = desc.match(/本技能位于(\d+)号位时.*?能耗-(\d+)/);
  if (costSingleMatch && parseInt(costSingleMatch[1]) === slot) {
    costReduction += parseInt(costSingleMatch[2]);
  }

  return { powerBonus, costReduction };
}

export function applyTransmission(moveSlots: Move[]): Move[] {
  if (moveSlots.length === 0) return moveSlots;
  const newSlots = [...moveSlots];
  const shifts: { fromIdx: number; amount: number }[] = [];
  for (let i = 0; i < newSlots.length; i++) {
    const tv = getTransmissionValue(newSlots[i]);
    if (tv > 0) shifts.push({ fromIdx: i, amount: tv });
  }
  if (shifts.length === 0) return newSlots;

  for (const { fromIdx, amount } of shifts) {
    const move = newSlots[fromIdx];
    newSlots.splice(fromIdx, 1);
    const targetIdx = Math.min(fromIdx + amount, newSlots.length);
    newSlots.splice(targetIdx, 0, move);
  }
  return newSlots;
}
export type Weather = "rain" | "blizzard" | "sandstorm" | null;

export type MarkName = "photosynthesis" | "moisture" | "narrative" | "charge" | "dragon" | "poison" | "spirit" | "starfall";

export interface Mark {
  name: MarkName;
  type: "positive" | "negative";
  layers: number;
  side: "my" | "enemy";
}

export interface BattlerState {
  monster: Monster;
  baseStats: Stats;
  currentHp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  freezeLayers: number;
  burnLayers: number;
  poisonLayers: number;
  statStages: StatStages;
  pctBuffs: PctBuffs;
  isLeader: boolean;
  originalMonster: Monster | null;
  isAlive: boolean;
  defending: boolean;
  chargedMove: Move | null;
  overloadStacks: number;
  lifestealPct: number;
  comboModifier: number;
  stunned: boolean;
  defenseCooldown: number;
  regressionLayers: number;
  turnsOnField: number;
  moveSlots: Move[];
  // ── Trait persistent fields ──
  magicPoints: number;         // 魔力值 (deprecated: moved to team level)
  dedicationCount: number;     // 奉献计数
  permanentAtkPct: number;     // 永久双攻% (指挥家/蓄电池)
  permanentDefPct: number;     // 永久双防% (合拍)
  skillPowerBonus: number;     // 永久技能威力+ (斗技)
  firstActionUsed: boolean;    // 首次行动已用 (起飞加速)
  entryCount: number;          // 入场次数 (蓄电池)
  teamSkillCounts: Record<string, number>; // 团队技能使用计数
  forceSwitch: boolean;        // 强制换人 (防过载/安可/奔波命)
  captureBall: string | null;  // 咕噜球类型 (契约的形状)
  beastBloodline: string | null; // 稀兽花宝血脉
}

export type Action =
  | { type: "move"; move: Move }
  | { type: "switch"; toIndex: number }
  | { type: "focus" }
  | { type: "release" };

export interface BattleEvent {
  description: string;
  side?: "my" | "enemy";
}

export interface TurnLog {
  turn: number;
  myAction: Action;
  enemyAction: Action;
  events: BattleEvent[];
}

export interface BattleState {
  turn: number;
  myTeam: BattlerState[];
  enemyTeam: BattlerState[];
  myActive: number;
  enemyActive: number;
  weather: Weather;
  marks: Mark[];
  log: TurnLog[];
  myMagicItem: MagicItemId | null;
  myMagicItemUses: number;
  myMagicItemCooldown: number;
  myWillpowerActive: boolean;
  myMagicPoints: number;          // 我方魔力值 (初始4)
  enemyMagicItem: MagicItemId | null;
  enemyMagicItemUses: number;
  enemyMagicItemCooldown: number;
  enemyWillpowerActive: boolean;
  enemyMagicPoints: number;       // 敌方魔力值 (初始4)
}

// PLACEHOLDER_INIT

const DEFAULT_STAGES: StatStages = { phyAtk: 0, magAtk: 0, phyDef: 0, magDef: 0, spd: 0 };
const DEFAULT_PCT_BUFFS: PctBuffs = { phyAtk: 0, magAtk: 0, phyDef: 0, magDef: 0, spd: 0 };

function createBattler(monster: Monster, personality: Personality | null, talent: Talent): BattlerState {
  const defaultPers: Personality = {
    id: 0, name: "Neutral", localized: { zh: "平衡" },
    hp_mod_pct: 0, phy_atk_mod_pct: 0, mag_atk_mod_pct: 0,
    phy_def_mod_pct: 0, mag_def_mod_pct: 0, spd_mod_pct: 0,
  };
  const stats = calcStats(monster, personality || defaultPers, talent);
  return {
    monster,
    baseStats: stats,
    currentHp: stats.hp,
    maxHp: stats.hp,
    energy: 10,
    maxEnergy: 10,
    freezeLayers: 0,
    burnLayers: 0,
    poisonLayers: 0,
    statStages: { ...DEFAULT_STAGES },
    pctBuffs: { ...DEFAULT_PCT_BUFFS },
    isLeader: false,
    originalMonster: null,
    isAlive: true,
    defending: false,
    chargedMove: null,
    overloadStacks: 0,
    lifestealPct: 0,
    comboModifier: 0,
    stunned: false,
    defenseCooldown: 0,
    regressionLayers: 0,
    turnsOnField: 0,
    moveSlots: [],
    magicPoints: 3,
    dedicationCount: 0,
    permanentAtkPct: 0,
    permanentDefPct: 0,
    skillPowerBonus: 0,
    firstActionUsed: false,
    entryCount: 0,
    teamSkillCounts: {},
    forceSwitch: false,
    captureBall: null,
    beastBloodline: null,
  };
}

export interface TeamMemberInput {
  monster: Monster;
  personality: Personality | null;
  talent: Talent;
  captureBall?: string | null;
  beastBloodline?: string | null;
}

export function initBattle(
  myTeam: TeamMemberInput[],
  enemyTeam: Monster[],
  myStarterIndex: number = 0,
  magicItem: MagicItemId | null = null
): BattleState {
  const safeMyStarter = myStarterIndex >= 0 && myStarterIndex < myTeam.length ? myStarterIndex : 0;
  return {
    turn: 0,
    myTeam: myTeam.map((m) => {
      const b = createBattler(m.monster, m.personality, m.talent);
      b.captureBall = m.captureBall || null;
      b.beastBloodline = m.beastBloodline || null;
      return b;
    }),
    enemyTeam: enemyTeam.map((m) => createBattler(m, getPopularPersonality(m.id) || null, getPopularTalent(m.id))),
    myActive: safeMyStarter,
    enemyActive: 0,
    weather: null,
    marks: [],
    log: [],
    myMagicItem: magicItem,
    myMagicItemUses: 0,
    myMagicItemCooldown: 0,
    myWillpowerActive: false,
    myMagicPoints: 4,
    enemyMagicItem: null,
    enemyMagicItemUses: 0,
    enemyMagicItemCooldown: 0,
    enemyWillpowerActive: false,
    enemyMagicPoints: 4,
  };
}

// Apply entry traits to both initial active battlers
export function applyInitialTraits(battle: BattleState): BattleState {
  const events: BattleEvent[] = [];
  applyEntryTraits(battle.myTeam[battle.myActive], battle.myTeam, battle.enemyTeam, "my", events);
  applyEntryTraits(battle.enemyTeam[battle.enemyActive], battle.enemyTeam, battle.myTeam, "enemy", events);
  return { ...battle, log: [...battle.log, { turn: 0, myAction: { type: "focus" }, enemyAction: { type: "focus" }, events }] };
}

export function applyLeaderForm(battle: BattleState, side: "my" | "enemy", leaderMonster: Monster): BattleState {
  const activeKey = side === "my" ? "myActive" : "enemyActive";
  const teamKey = side === "my" ? "myTeam" : "enemyTeam";
  const battler = battle[teamKey][battle[activeKey]];

  const hpRatio = battler.currentHp / battler.maxHp;
  const defaultPers: Personality = {
    id: 0, name: "Neutral", localized: { zh: "平衡" },
    hp_mod_pct: 0, phy_atk_mod_pct: 0, mag_atk_mod_pct: 0,
    phy_def_mod_pct: 0, mag_def_mod_pct: 0, spd_mod_pct: 0,
  };
  const stats = calcStats(leaderMonster, defaultPers, DEFAULT_TALENT);
  const newBattler: BattlerState = {
    ...battler,
    monster: leaderMonster,
    originalMonster: battler.monster,
    baseStats: stats,
    maxHp: stats.hp,
    currentHp: Math.max(1, Math.round(stats.hp * hpRatio)),
    isLeader: true,
    turnsOnField: 0,
  };

  return {
    ...battle,
    [teamKey]: battle[teamKey].map((b, i) => i === battle[activeKey] ? newBattler : b),
  };
}

export function createWillpowerMove(bloodlineTypeName: string): Move | null {
  const base = WILLPOWER_BASE;
  if (!base) return null;
  const bloodlineType = types.find((t) => t.name === bloodlineTypeName);
  return {
    ...base,
    move_type: bloodlineType || base.move_type,
  };
}

export function canUseMagicItem(battle: BattleState, side: "my" | "enemy"): boolean {
  const item = side === "my" ? battle.myMagicItem : battle.enemyMagicItem;
  const uses = side === "my" ? battle.myMagicItemUses : battle.enemyMagicItemUses;
  const cd = side === "my" ? battle.myMagicItemCooldown : battle.enemyMagicItemCooldown;
  if (!item) return false;
  const def = MAGIC_ITEMS.find((m) => m.id === item);
  if (!def) return false;
  if (uses >= def.maxUses) return false;
  if (cd > 0) return false;
  return true;
}

export function applyMagicItem(battle: BattleState, side: "my" | "enemy", leaderMonster?: Monster): BattleState {
  if (!canUseMagicItem(battle, side)) return battle;
  const next = structuredClone(battle) as BattleState;
  const item = side === "my" ? next.myMagicItem : next.enemyMagicItem;
  const def = MAGIC_ITEMS.find((m) => m.id === item)!;
  if (side === "my") {
    next.myMagicItemUses += 1;
    next.myMagicItemCooldown = def.cooldown;
  } else {
    next.enemyMagicItemUses += 1;
    next.enemyMagicItemCooldown = def.cooldown;
  }

  switch (item) {
    case "evolution_power": {
      if (!leaderMonster) return battle;
      return applyLeaderForm(next, side, leaderMonster);
    }
    case "willpower_enhancement": {
      if (side === "my") next.myWillpowerActive = true;
      else next.enemyWillpowerActive = true;
      break;
    }
  }
  return next;
}

// PLACEHOLDER_RESOLVE

function stageMultiplier(stage: number): number {
  if (stage >= 0) return (2 + stage) / 2;
  return 2 / (2 + Math.abs(stage));
}

function getEffectiveSpeed(battler: BattlerState): number {
  const regress = 1 - battler.regressionLayers * 0.08;
  return Math.round(battler.baseStats.spd * stageMultiplier(battler.statStages.spd) * (1 + battler.pctBuffs.spd / 100) * regress);
}

function getTypeInfo(typeName: string): TypeInfo | undefined {
  return types.find((t) => t.name === typeName);
}

function computeDamage(
  attacker: BattlerState,
  defender: BattlerState,
  move: Move,
  weather: Weather,
  isCounter: boolean,
  marks: Mark[],
  attackerSide: "my" | "enemy",
  moveSlotIndex: number = -1,
  traitPowerMod: number = 1.0
): { damage: number; typeEff: number } {
  if (!move.power || move.move_category === "Status" || move.move_category === "Defense")
    return { damage: 0, typeEff: 1.0 };

  const isPhysical = move.move_category === "Physical Attack";
  const baseAtk = isPhysical ? attacker.baseStats.phyAtk : attacker.baseStats.magAtk;
  const baseDef = isPhysical ? defender.baseStats.phyDef : defender.baseStats.magDef;
  const atkStage = isPhysical ? attacker.statStages.phyAtk : attacker.statStages.magAtk;
  const defStage = isPhysical ? defender.statStages.phyDef : defender.statStages.magDef;
  const atkPct = isPhysical ? attacker.pctBuffs.phyAtk : attacker.pctBuffs.magAtk;
  const defPct = isPhysical ? defender.pctBuffs.phyDef : defender.pctBuffs.magDef;

  const attackerRegress = 1 - attacker.regressionLayers * 0.08;
  const defenderRegress = 1 - defender.regressionLayers * 0.08;
  // Include permanent trait attack/defense bonuses
  const totalAtkPct = atkPct + (attacker.permanentAtkPct || 0);
  const totalDefPct = defPct + (defender.permanentDefPct || 0);
  const effectiveAtk = Math.round(baseAtk * stageMultiplier(atkStage) * (1 + totalAtkPct / 100) * attackerRegress);
  const effectiveDef = Math.round(baseDef * stageMultiplier(defStage) * (1 + totalDefPct / 100) * defenderRegress);

  let moveTypeName = move.move_type?.name || "";
  // 展翅: 普通系技能→翼系
  if (moveTypeName === "Normal" && descHasTrait(attacker.monster, "普通系技能变为翼系技能")) {
    moveTypeName = "Flying";
  }
  const isStab = moveTypeName === attacker.monster.main_type.name ||
    moveTypeName === attacker.monster.sub_type?.name;

  const defenderTypes: TypeInfo[] = [];
  const mainType = getTypeInfo(defender.monster.main_type.name);
  if (mainType) defenderTypes.push(mainType);
  if (defender.monster.sub_type) {
    const subType = getTypeInfo(defender.monster.sub_type.name);
    if (subType) defenderTypes.push(subType);
  }
  let typeEff = getTypeEffectiveness(moveTypeName, defenderTypes);

  // 狂欢开始 (机幕方舟): 受到的克制伤害 +25%
  if (typeEff > 1 && hasCarnivalStart(defender.monster)) {
    typeEff *= 1.25;
  }

  // 偏振: 受到自己携带技能系别的攻击伤害-40%
  if (descHasTrait(defender.monster, "受到自己携带技能系别的攻击伤害")) {
    const myTypes = [defender.monster.main_type.name];
    if (defender.monster.sub_type) myTypes.push(defender.monster.sub_type.name);
    if (myTypes.includes(moveTypeName)) {
      typeEff *= 0.6;
    }
  }

  // 惊吓: 能量等于0的精灵无法对自己造成伤害
  if (descHasTrait(defender.monster, "能量等于0的精灵") && attacker.energy === 0) {
    return { damage: 0, typeEff };
  }

  // 逐魂鸟: 能耗≤1的攻击技能无法对自己造成伤害
  if (descHasTrait(defender.monster, "能耗小于等于1的攻击技能") && move.energy_cost <= 1) {
    return { damage: 0, typeEff };
  }

  // 绝对秩序: 受非敌方主系技能攻击时伤害-50%
  if (descHasTrait(defender.monster, "受到非敌方系列的技能攻击")) {
    const enemyMainType = attacker.monster.main_type.name;
    if (moveTypeName !== enemyMainType && attacker.monster.sub_type?.name !== moveTypeName) {
      typeEff *= 0.5;
    }
  }

  // 天通地明/月光审判/缤纷星光: 血脉判定增伤
  if (descHasTrait(attacker.monster, "血脉")) {
    const traitD = attacker.monster.trait?.localized?.zh?.description || "";
    const pwMatch = traitD.match(/威力\+(\d+)%/);
    if (pwMatch) {
      const bonus = parseInt(pwMatch[1]);
      const defBloodline = defender.monster.default_legacy_type?.name || defender.monster.main_type.name;
      // 月光审判: 敌方血脉是首领血脉→+100%
      if (traitD.includes("敌方血脉是首领血脉") && defBloodline === "Leader") {
        typeEff *= (1 + bonus / 100);
      }
      // 天通地明: 敌方血脉是污染血脉→+100%
      if (traitD.includes("敌方血脉是污染血脉") && defBloodline === "Poison") {
        typeEff *= (1 + bonus / 100);
      }
      // 缤纷星光: 敌方血脉是非本系的系列血脉→+100% (approximate)
      if (traitD.includes("非本系的系列血脉")) {
        typeEff *= (1 + bonus / 100);
      }
    }
  }

  let weatherMod = 1.0;
  if (weather === "rain" && moveTypeName === "Water") weatherMod = 1.75;

  const counterMod = isCounter ? 2.5 : 1.0;

  // Narrative/蓄势 mark: +30% attack power
  const hasNarrative = marks.some((m) => m.name === "narrative" && m.side === attackerSide);
  const markMod = hasNarrative ? 1.3 : 1.0;

  // Charge/蓄电 mark: +10 power on first turn after entry
  const hasCharge = marks.some((m) => m.name === "charge" && m.side === attackerSide);
  const powerBonus = (hasCharge && attacker.turnsOnField === 0) ? 10 : 0;

  // Slot position bonus (传动 system)
  const slotBonus = moveSlotIndex >= 0 ? getSlotBonus(move, moveSlotIndex).powerBonus : 0;

  // 顺风/破空: 若先于敌方攻击，本次技能威力+X%
  let speedPowerMod = 1.0;
  const isFaster = getEffectiveSpeed(attacker) >= getEffectiveSpeed(defender);
  if (isFaster) {
    if (descHasTrait(attacker.monster, "若先于敌方攻击") && descHasTrait(attacker.monster, "威力+75%")) speedPowerMod += 0.75;
    else if (descHasTrait(attacker.monster, "若先于敌方攻击") && descHasTrait(attacker.monster, "威力+50%")) speedPowerMod += 0.50;
  }

  // 挺起胸脯: 携带的能耗为1的技能威力+50%
  let costPowerMod = 1.0;
  if (move.energy_cost === 1 && descHasTrait(attacker.monster, "能耗为1的技能") && descHasTrait(attacker.monster, "威力+50%")) {
    costPowerMod += 0.50;
  }

  // 勇敢: 能耗>3的技能威力+40%
  if (move.energy_cost > 3 && descHasTrait(attacker.monster, "能耗大于3的技能") && descHasTrait(attacker.monster, "威力+")) {
    const bm = attacker.monster.trait?.localized?.zh?.description?.match(/威力\+(\d+)%/);
    if (bm) costPowerMod += parseInt(bm[1]) / 100;
  }

  // 目空: 非光系技能威力+25%
  if (moveTypeName !== "Light" && descHasTrait(attacker.monster, "非光系技能") && descHasTrait(attacker.monster, "威力+")) {
    const nm = attacker.monster.trait?.localized?.zh?.description?.match(/威力\+(\d+)%/);
    if (nm) costPowerMod += parseInt(nm[1]) / 100;
  }

  // 涂鸦: 非本系技能威力+50%
  if (moveTypeName !== attacker.monster.main_type.name && descHasTrait(attacker.monster, "非本系技能") && descHasTrait(attacker.monster, "威力+")) {
    const gm = attacker.monster.trait?.localized?.zh?.description?.match(/威力\+(\d+)%/);
    if (gm) costPowerMod += parseInt(gm[1]) / 100;
  }

  // 不移: 无额外效果的攻击技能威力+30%
  if (descHasTrait(attacker.monster, "无额外效果的攻击技能") && descHasTrait(attacker.monster, "威力+")) {
    const effects = parseMoveEffects(move);
    if (effects.length === 0) {
      const nm2 = attacker.monster.trait?.localized?.zh?.description?.match(/威力\+(\d+)%/);
      if (nm2) costPowerMod += parseInt(nm2[1]) / 100;
    }
  }

  // 共鸣: 携带特定技能威力提升
  if (descHasTrait(attacker.monster, "威力+") && (descHasTrait(attacker.monster, "【") || descHasTrait(attacker.monster, "「"))) {
    const skillNames = [...(attacker.monster.trait?.localized?.zh?.description?.matchAll(/[【「](.+?)[】」]/g) || [])];
    const matched = skillNames.some(m => move.localized.zh.name.includes(m[1]));
    if (matched) {
      const pwm = attacker.monster.trait?.localized?.zh?.description?.match(/威力\+(\d+)/);
      if (pwm) costPowerMod += parseInt(pwm[1]) / 100;
    }
  }

  // 冻土: 每携带1个冰系→地系威力+10%
  if (descHasTrait(attacker.monster, "每携带1个") && descHasTrait(attacker.monster, "系技能进入战斗")) {
    const ct = attacker.monster.trait?.localized?.zh?.description?.match(/每携带1个(\S+)系技能/);
    const bt = attacker.monster.trait?.localized?.zh?.description?.match(/(\S+)系技能威力\+(\d+)%/);
    if (ct && bt && moveTypeName === types.find(t => t.localized.zh === bt[1])?.name) {
      const count = attacker.moveSlots.filter(m => m.move_type?.name === types.find(t => t.localized.zh === ct[1])?.name).length;
      costPowerMod += (parseInt(bt[2]) / 100) * count;
    }
  }

  // 换碟: 特定技能威力提升
  if (descHasTrait(attacker.monster, "音波弹") || descHasTrait(attacker.monster, "音爆")) {
    const skillList = ["音波弹", "音爆", "金属噪音", "午夜噪音"];
    if (skillList.some(s => move.localized.zh.name.includes(s))) {
      costPowerMod += 0.30; // approximate boost
    }
  }

  const totalPowerMod = traitPowerMod * speedPowerMod * costPowerMod;
  const basePower = move.power + powerBonus + slotBonus + (attacker.skillPowerBonus || 0);
  const adjustedPower = Math.round(basePower * totalPowerMod);

  const result = calcDamage(
    Math.round(effectiveAtk * weatherMod * counterMod * markMod),
    effectiveDef,
    adjustedPower,
    typeEff,
    isStab
  );
  return { damage: result.max, typeEff };
}

// Helper: check if monster trait description contains text
function descHasTrait(monster: Monster, text: string): boolean {
  const desc = monster.trait?.localized?.zh?.description || monster.trait?.description || "";
  return desc.includes(text);
}

// Trait effect label with tooltip
export interface TraitEffectLabel {
  label: string;
  tooltip: string;
  isPermanent: boolean; // true = survives switch, false = clears on switch
}

// Compute human-readable trait effect labels for display in BattlerPanel
export function getTraitEffectLabels(battler: BattlerState): TraitEffectLabel[] {
  const trait = battler.monster.trait;
  if (!trait) return [];
  const desc = trait.localized?.zh?.description || trait.description || "";
  const name = trait.localized?.zh?.name || trait.name || "";
  const labels: TraitEffectLabel[] = [];
  const seen = new Set<string>();

  // Helper: add a label
  const add = (label: string, tooltip: string, isPermanent: boolean = false) => {
    if (!seen.has(label)) { seen.add(label); labels.push({ label, tooltip, isPermanent }); }
  };

  // === 迪莫：最好的伙伴 ===
  if (desc.includes("造成克制伤害后") && desc.includes("攻防速")) add(`${name}`, `${name}`, false);

  // === 顺风/破空：先手威力提升 ===
  if (desc.includes("若先于敌方攻击") && desc.includes("威力")) {
    const pm = desc.match(/威力\+(\d+)%/);
    if (pm) add(`${name}: 先手+${pm[1]}%威`, `${name}: 先手+${pm[1]}%威`, false);
  }

  // === 挺起胸脯：1费技能+50% ===
  if (desc.includes("能耗为1的技能") && desc.includes("威力")) {
    add(`${name}: 1费+50%威`, `${name}: 1费+50%威`, false);
  }

  // === 偏振：减伤 ===
  if (desc.includes("受到自己携带技能系别的攻击伤害")) {
    add(`${name}: 本系减伤40%`, `${name}: 本系减伤40%`, false);
  }

  // === 缩壳：防御能耗-2 ===
  if (desc.includes("携带的防御技能能耗-2")) {
    add(`${name}: 防御-2费`, `${name}: 防御-2费`, false);
  }

  // === 石头大餐 ===
  if (desc.includes("能量不足时") && desc.includes("生命代替")) {
    add(`${name}: 耗血代能`, `${name}: 耗血代能`, false);
  }

  // === 惊吓 ===
  if (desc.includes("能量等于0的精灵") && desc.includes("无法造成伤害")) {
    add(`${name}: 免疫0能`, `${name}: 免疫0能`, false);
  }

  // === 加个雪球 ===
  if (desc.includes("使敌方获得冻结") && desc.includes("也会使其获得")) {
    add(`${name}: 冻结+2`, `${name}: 冻结+2`, false);
  }

  // === 类型使用触发 ===
  const typeUse = desc.match(/使用(\S+)系技能[后时]/);
  if (typeUse) {
    const t = typeUse[1];
    if (desc.includes("双攻+")) { const m = desc.match(/双攻\+(\d+)%/); if (m) add(`${name}: ${t}系→双攻+${m[1]}%`, `${name}: ${t}系→双攻+${m[1]}%`, false); }
    if (desc.includes("连击数+")) { const m = desc.match(/连击数\+(\d+)/); if (m) add(`${name}: ${t}系→连击+${m[1]}`, `${name}: ${t}系→连击+${m[1]}`, false); }
    if (desc.includes("中毒")) add(`${name}: ${t}系→中毒`, `${name}: ${t}系→中毒`, false);
    if (desc.includes("回复") && desc.includes("生命")) { const m = desc.match(/回复(\d+)%生命/); if (m) add(`${name}: ${t}系→回${m[1]}%`, `${name}: ${t}系→回${m[1]}%`, false); }
    if (desc.includes("能耗-")) { const m = desc.match(/能耗-(\d+)/); if (m) add(`${name}: ${t}系→能耗-${m[1]}`, `${name}: ${t}系→能耗-${m[1]}`, false); }
  }

  // === 盲从：非幻-2费 ===
  if (desc.includes("非幻系技能能耗-2")) {
    add(`${name}: 非幻-2费`, `${name}: 非幻-2费`, false);
  }

  // === 狂欢开始：受克制+25% ===
  if (desc.includes("受到的克制伤害+25%")) {
    add(`${name}: 受克制+25%`, `${name}: 受克制+25%`, false);
  }

  // === 免疫致命伤 ===
  if (desc.includes("受到致命伤害时") && desc.includes("免疫此次伤害")) {
    add(`${name}: 免疫致命`, `${name}: 免疫致命`, false);
  }

  // === 刺肤/反击 ===
  if (desc.includes("对攻击自己的精灵造成")) {
    const m = desc.match(/造成(\d+)威力/);
    if (m) add(`${name}: 反击${m[1]}威`, `${name}: 反击${m[1]}威`, false);
  }

  // === 入场能量 ===
  if (desc.includes("初始能量为0")) add(`${name}: 入场0能`, `${name}: 入场0能`, false);

  // === 团队buff ===
  if (desc.includes("队伍中每有1只")) {
    const tc = desc.match(/攻防速\+(\d+)%/);
    if (tc) add(`${name}: 队友buff`, `${name}: 队友buff`, false);
  }
  if (desc.includes("队伍存在") && desc.includes("双攻+")) {
    add(`${name}: 团队双攻`, `${name}: 团队双攻`, false);
  }

  // === 每有1能量→buff ===
  if (desc.includes("每有1能量") && desc.includes("双防+")) {
    const m = desc.match(/双防\+(\d+)%/);
    if (m) add(`${name}: 双防+${battler.energy * parseInt(m[1])}%`, `${name}: 双防+${battler.energy * parseInt(m[1])}%`, false);
  }

  // === 渴求/吸血 ===
  if (desc.includes("入场时获得") && desc.includes("吸血")) {
    add(`${name}: 吸血${battler.lifestealPct}%`, `${name}: 吸血${battler.lifestealPct}%`, false);
  }

  // === KO buff ===
  if (desc.includes("主动击败敌方精灵时") || desc.includes("击败敌方精灵时")) {
    if (desc.includes("双攻+")) add(`${name}: KO双攻`, `${name}: KO双攻`, false);
  }

  // === 应对成功 ===
  if (desc.includes("应对成功后") && desc.includes("双攻+")) {
    add(`${name}: 应对双攻`, `${name}: 应对双攻`, false);
  }
  if (desc.includes("应对成功后") && desc.includes("威力翻倍")) {
    add(`${name}: 应对翻倍`, `${name}: 应对翻倍`, false);
  }

  // === 嫁祸/自由飘 ===
  if (desc.includes("每失去") && desc.includes("生命") && desc.includes("连击数+")) {
    add(`${name}: 受伤连击`, `${name}: 受伤连击`, false);
  }
  if (desc.includes("每有1层萌化") && desc.includes("连击数+")) {
    add(`${name}: 萌化连击`, `${name}: 萌化连击`, false);
  }

  // === 侵性 ===
  if (desc.includes("每有1层中毒") && desc.includes("连击数+")) {
    add(`${name}: 中毒连击`, `${name}: 中毒连击`, false);
  }

  // === 毒蘑菇 ===
  if (desc.includes("偷取")) add(`${name}: 偷能`, `${name}: 偷能`, false);

  // === 快充 ===
  if (desc.includes("离场时") && desc.includes("回复")) {
    add(`${name}: 离场回能`, `${name}: 离场回能`, false);
  }

  // === 保守派 ===
  if (desc.includes("总技能能耗")) {
    const total = battler.moveSlots.reduce((s, m) => s + m.energy_cost, 0);
    const th = desc.match(/小于(\d+)/);
    if (th && total < parseInt(th[1])) add(`${name}: 双防+${desc.match(/双防\+(\d+)%/)![1]}`, `${name}: 双防+${desc.match(/双防\+(\d+)%/)![1]}`, false);
  }

  // === 养分内循环 ===
  if (desc.includes("回合结束时") && desc.includes("回复") && desc.includes("能量") && !desc.includes("偷取")) {
    const m = desc.match(/回复(\d+)能量/);
    if (m) add(`${name}: 回能${m[1]}`, `${name}: 回能${m[1]}`, false);
  }

  // === 特殊/被动威力 ===
  if (desc.includes("无额外效果的攻击技能") && desc.includes("威力")) add(`${name}: 纯技+威`, `${name}: 纯技+威`, false);
  if (desc.includes("非光系技能") && desc.includes("威力")) add(`${name}: 非光+威`, `${name}: 非光+威`, false);
  if (desc.includes("非本系技能") && desc.includes("威力")) add(`${name}: 非本+威`, `${name}: 非本+威`, false);
  if (desc.includes("能耗大于3的技能") && desc.includes("威力")) add(`${name}: 大费+威`, `${name}: 大费+威`, false);

  // === Accumulated buffs (cleared on switch, recalculated on re-entry) ===
  if (battler.permanentAtkPct) {
    add(`攻+${battler.permanentAtkPct}%`, `本场累积双攻+${battler.permanentAtkPct}% · 换人后重新计算`, false);
  }
  if (battler.permanentDefPct) {
    add(`防+${battler.permanentDefPct}%`, `本场累积双防+${battler.permanentDefPct}% · 换人后重新计算`, false);
  }
  if (battler.skillPowerBonus) {
    add(`威+${battler.skillPowerBonus}`, `本场累积技能威力+${battler.skillPowerBonus} · 换人后重新计算`, false);
  }

  // === 魔力 (preserved across switch - death mechanic) ===
  if (desc.includes("少损失") && desc.includes("魔力")) {
    add(`${name}: ${battler.magicPoints || 3}魔力`, `魔力值 · 死亡时扣减`, false);
  }
  if (desc.includes("扣除") && desc.includes("魔力")) {
    add(`${name}: ${battler.magicPoints || 3}魔力`, `魔力值 · 死亡时扣减`, false);
  }

  // === 奉献 (recalculated on re-entry) ===
  if (battler.dedicationCount > 0) {
    add(`奉献×${battler.dedicationCount}`, `本场累积奉献 · 换人后重新计算`, false);
  }

  // === 蓄电池 (cross-switch cumulative) ===
  if (desc.includes("每入场1次") && desc.includes("双攻+")) {
    add(`${name}: ${battler.entryCount || 0}次入场`, `累计入场${battler.entryCount || 0}次 · 换人不重置`, true);
  }

  // === 得寸进尺 ===
  if (desc.includes("天气为雨天") && desc.includes("双攻+")) {
    add(`${name}: 雨天+100%`, `${name}: 雨天+100%`, false);
  }

  // === 洁癖/继承 ===
  if (desc.includes("继承")) add(`${name}: 继承`, `${name}: 继承`, false);

  // === 正位宝剑 ===
  if (desc.includes("仅可以使用1号位技能")) add(`${name}: 仅1号位`, `${name}: 仅1号位`, false);

  // === 多人宿舍 ===
  if (desc.includes("能量可以超过能量上限")) add(`${name}: 能超15`, `${name}: 能超15`, false);

  // === 起飞加速 ===
  if (desc.includes("首次使用的技能获得迅捷")) add(`${name}: 首技迅捷`, `${name}: 首技迅捷`, false);

  // === 防过载 ===
  if (desc.includes("每次行动后脱离")) add(`${name}: 动后脱离`, `${name}: 动后脱离`, false);

  // === 无差别过滤 ===
  if (desc.includes("连击数固定为2")) add(`${name}: 连击=2`, `${name}: 连击=2`, false);

  // === 盛宴 ===
  if (desc.includes("盛宴") || (desc.includes("生命低于50%") && desc.includes("吸血"))) add(`${name}: 低血吸血`, `${name}: 低血吸血`, false);

  // === 展翅 ===
  if (desc.includes("普通系技能变为翼系技能")) add(`${name}: 普→翼`, `${name}: 普→翼`, false);

  // === 对流 ===
  if (desc.includes("能耗增加变为能耗降低")) add(`${name}: 反转能耗`, `${name}: 反转能耗`, false);

  // === 倾轧 ===
  if (desc.includes("能耗变化效果的影响翻倍")) add(`${name}: 双倍能耗`, `${name}: 双倍能耗`, false);

  // === 嫉妒 ===
  if (desc.includes("蓄力状态下") && desc.includes("可以使用任一")) add(`${name}: 蓄力自由`, `${name}: 蓄力自由`, false);

  // === 安可 ===
  if (desc.includes("使用光系技能后") && desc.includes("返场")) add(`${name}: 光返场`, `${name}: 光返场`, false);

  // === 绝对秩序 ===
  if (desc.includes("受到非敌方系列的技能攻击")) add(`${name}: 异系减伤`, `${name}: 异系减伤`, false);

  // === 逐魂鸟 ===
  if (desc.includes("能耗小于等于1的攻击技能")) add(`${name}: 低费免疫`, `${name}: 低费免疫`, false);

  // === 棋契变形 ===
  if (desc.includes("回满状态") && desc.includes("变为")) add(`${name}: 应对变形`, `${name}: 应对变形`, false);

  // === 奔波命 ===
  if (desc.includes("使用防御技能后") && desc.includes("脱离")) add(`${name}: 防后脱离`, `${name}: 防后脱离`, false);

  // === 火龙/爆燃 ===
  if (desc.includes("使用火系技能后") && desc.includes("双攻+30%")) add(`${name}: 火→双攻+30%`, `${name}: 火→双攻+30%`, false);

  // === 浪潮 ===
  if (desc.includes("使用水系技能后") && desc.includes("能耗-2")) add(`${name}: 水→能耗-2`, `${name}: 水→能耗-2`, false);

  // === 快锤 ===
  if (desc.includes("能耗小于3的技能") && desc.includes("迅捷")) add(`${name}: 低费迅捷`, `${name}: 低费迅捷`, false);

  // === 暴食 ===
  if (desc.includes("龙系技能获得迅捷")) add(`${name}: 龙系迅捷`, `${name}: 龙系迅捷`, false);

  // === 贪心算法 ===
  if (desc.includes("1号位技能获得传动")) add(`${name}: 1号传动`, `${name}: 1号传动`, false);

  // === 翼轴 ===
  if (desc.includes("1号位技能获得迅捷和传动")) add(`${name}: 1号迅传`, `${name}: 1号迅传`, false);

  // === 向心力 ===
  if (desc.includes("1号和2号位技能获得传动")) add(`${name}: 1/2号传动`, `${name}: 1/2号传动`, false);

  // === 机械要式 ===
  if (desc.includes("每回合位置变化时") && desc.includes("能耗-1")) add(`${name}: 传动-1费`, `${name}: 传动-1费`, false);

  // === 盲拧 ===
  if (desc.includes("技能顺序打乱")) add(`${name}: 打乱技能`, `${name}: 打乱技能`, false);

  // === 天通地明/月光审判/缤纷星光 ===
  if (desc.includes("血脉") && desc.includes("威力+")) {
    add(`${name}: 血脉增威`, `${name}: 血脉增威`, false);
  }

  // === 哨兵/先知/预警 ===
  if (desc.includes("速度+50")) add(`${name}: 预判加速`, `${name}: 预判加速`, false);

  // === 铃兰晚钟 ===
  if (desc.includes("失去自己一半的当前生命")) add(`${name}: 半血入场`, `${name}: 半血入场`, false);

  // === 连续负荷 ===
  if (desc.includes("迸发效果延长1回合")) add(`${name}: 迸发延长`, `${name}: 迸发延长`, false);

  // === 掠夺/下黑手/做噩梦 ===
  if (desc.includes("更换入场的精灵")) add(`${name}: 入场触发`, `${name}: 入场触发`, false);

  // === 吟游之弦 ===
  if (desc.includes("印记不会替换其他印记")) add(`${name}: 双印记`, `${name}: 双印记`, false);

  // === 稀兽花宝/契约的形状 ===
  if (desc.includes("入场时获得不同效果")) add(`${name}: 契约入场`, `${name}: 契约入场`, false);

  // === 三鼓作气 ===
  if (desc.includes("使用能耗为3的技能时") && desc.includes("攻防")) add(`${name}: 3费攻防`, `三鼓作气 · 本场累积攻防+20% · 换人重新计算`, false);

  // === 汩游 ===
  if (desc.includes("蓄力状态") && desc.includes("能耗")) add(`${name}: 蓄力减费`, `${name}: 蓄力减费`, false);

  // === 消波块 ===
  if (desc.includes("每携带1个") && desc.includes("进入战斗") && desc.includes("能耗-")) add(`${name}: 跨系减费`, `${name}: 跨系减费`, false);

  // === Generic: always show trait name if nothing else matched ===
  if (labels.length === 0 && name) {
    labels.push({ label: name, tooltip: desc, isPermanent: false });
  }

  return labels;
}

// PLACEHOLDER_RESOLVE_TURN

function isCounterSuccess(myAction: Action, enemyAction: Action): { myCounters: boolean; enemyCounters: boolean } {
  const getMoveCategory = (action: Action): string | null => {
    if (action.type === "move") return action.move.move_category;
    if (action.type === "release") return "Physical Attack";
    if (action.type === "focus") return "Status";
    return null;
  };

  const myCategory = getMoveCategory(myAction);
  const enemyCategory = getMoveCategory(enemyAction);

  let myCounters = false;
  let enemyCounters = false;

  if (myCategory && enemyCategory) {
    const isAtk = (c: string) => c === "Physical Attack" || c === "Magic Attack";
    // Defense counters Attack
    if (myCategory === "Defense" && isAtk(enemyCategory)) myCounters = true;
    // Attack counters Status
    if (isAtk(myCategory) && enemyCategory === "Status") myCounters = true;
    // Status counters Defense
    if (myCategory === "Status" && enemyCategory === "Defense") myCounters = true;

    if (enemyCategory === "Defense" && isAtk(myCategory)) enemyCounters = true;
    if (isAtk(enemyCategory) && myCategory === "Status") enemyCounters = true;
    if (enemyCategory === "Status" && myCategory === "Defense") enemyCounters = true;
  }

  return { myCounters, enemyCounters };
}

function applySwitch(team: BattlerState[], fromIndex: number, toIndex: number): void {
  team[fromIndex].statStages = { ...DEFAULT_STAGES };
  team[fromIndex].pctBuffs = { ...DEFAULT_PCT_BUFFS };
  team[fromIndex].lifestealPct = 0;
  team[fromIndex].comboModifier = 0;
  team[fromIndex].burnLayers = 0;
  team[fromIndex].poisonLayers = 0;
  team[fromIndex].chargedMove = null;
  team[fromIndex].firstActionUsed = false;
  // Clear trait accumulations (will be recalculated on re-entry)
  team[fromIndex].permanentAtkPct = 0;
  team[fromIndex].permanentDefPct = 0;
  team[fromIndex].skillPowerBonus = 0;
  team[fromIndex].dedicationCount = 0;
  // Only preserve: magicPoints (death mechanic), entryCount (explicitly cumulative)
  team[toIndex].turnsOnField = 0;
  team[toIndex].entryCount += 1;
}

export function isChargeMove(move: Move): boolean {
  return move.description.includes("蓄力") || move.localized.zh.description.includes("蓄力");
}

export function getComboCount(move: Move): number {
  const desc = move.localized?.zh?.description || move.description || "";
  const match = desc.match(/(\d+)连击/);
  return match ? parseInt(match[1]) : 1;
}

// ── Entry traits (applied when switching in or battle start) ──
function applyEntryTraits(battler: BattlerState, team: BattlerState[], oppTeam: BattlerState[], side: "my" | "enemy", events: BattleEvent[]): void {
  const trait = battler.monster.trait;
  if (!trait) return;
  const desc = trait.localized?.zh?.description || trait.description || "";
  const label = side === "my" ? "我方" : "敌方";

  // === Team-count buffs: 队伍中每有1只X系 → buff ===
  let teamCountMatch = desc.match(/队伍中每有(\d+)只其他的(\S+)系/);
  if (!teamCountMatch) teamCountMatch = desc.match(/队伍中每有1只其他的(\S+)系/);
  if (teamCountMatch) {
    const typeName = teamCountMatch[2] || teamCountMatch[1];
    const typeInfo = types.find(t => t.localized.zh === typeName);
    const count = team.filter((b, i) => i !== team.indexOf(battler) && b.monster.main_type.name === typeInfo?.name).length;
    const buffMatch = desc.match(/攻防速\+(\d+)%/);
    if (buffMatch && count > 0) {
      const val = parseInt(buffMatch[1]) * count;
      battler.pctBuffs.phyAtk = Math.min(200, battler.pctBuffs.phyAtk + val);
      battler.pctBuffs.magAtk = Math.min(200, battler.pctBuffs.magAtk + val);
      battler.pctBuffs.phyDef = Math.min(200, battler.pctBuffs.phyDef + val);
      battler.pctBuffs.magDef = Math.min(200, battler.pctBuffs.magDef + val);
      battler.pctBuffs.spd = Math.min(200, battler.pctBuffs.spd + val);
      events.push({ description: `${label}特性：攻防速+${val}%（${count}只${typeName}系队友）`, side });
    }
  }

  // === Team-has-type buffs: 队伍存在X系 → buff ===
  if (desc.includes("队伍存在") && desc.includes("获得双攻+")) {
    const tm = desc.match(/队伍存在(\S+)系/);
    const am = desc.match(/双攻\+(\d+)%/);
    if (tm && am && team.some(b => b.monster.main_type.localized.zh === tm[1])) {
      const v = parseInt(am[1]);
      battler.pctBuffs.phyAtk = Math.min(200, battler.pctBuffs.phyAtk + v);
      battler.pctBuffs.magAtk = Math.min(200, battler.pctBuffs.magAtk + v);
      events.push({ description: `${label}特性：双攻+${v}%`, side });
    }
  }

  // === Force-killed buffs: 队伍中每有1只力竭 → buff ===
  if (desc.includes("力竭的精灵") && desc.includes("双攻+")) {
    const dead = team.filter(b => !b.isAlive).length;
    const am = desc.match(/双攻\+(\d+)%/);
    if (am && dead > 0) {
      const v = parseInt(am[1]) * dead;
      battler.pctBuffs.phyAtk = Math.min(200, battler.pctBuffs.phyAtk + v);
      battler.pctBuffs.magAtk = Math.min(200, battler.pctBuffs.magAtk + v);
      events.push({ description: `${label}特性：双攻+${v}%（${dead}只力竭）`, side });
    }
  }

  // === Initial energy = 0 ===
  if (desc.includes("初始能量为0") || (desc.includes("初始能量为0") && desc.includes("入场前"))) {
    battler.energy = 0;
    events.push({ description: `${label}特性：初始能量为0`, side });
  }

  // === Energy cost threshold buffs: 总技能能耗<N → buff ===
  if (desc.includes("总技能能耗") || desc.includes("携带技能总能耗")) {
    const totalCost = battler.moveSlots.reduce((s, m) => s + m.energy_cost, 0);
    const df = desc.match(/双防\+(\d+)%/);
    const th = desc.match(/小于(\d+)/);
    if (df && th && totalCost < parseInt(th[1])) {
      const dv = parseInt(df[1]);
      battler.pctBuffs.phyDef = Math.min(200, battler.pctBuffs.phyDef + dv);
      battler.pctBuffs.magDef = Math.min(200, battler.pctBuffs.magDef + dv);
      events.push({ description: `${label}特性：双防+${dv}%，总能耗${totalCost}<${th[1]}`, side });
    }
  }

  // === Per-energy buffs: 每有1能量 → 双防+X% ===
  if (desc.includes("每有1能量") && desc.includes("双防+")) {
    const dp = parseInt(desc.match(/双防\+(\d+)%/)![1]);
    const bonus = battler.energy * dp;
    battler.pctBuffs.phyDef = Math.min(200, battler.pctBuffs.phyDef + bonus);
    battler.pctBuffs.magDef = Math.min(200, battler.pctBuffs.magDef + bonus);
    events.push({ description: `${label}特性：双防+${bonus}%`, side });
  }

  // === 专注力/全神贯注: 入场首回合物攻+100% ===
  if (desc.includes("入场首回合") || desc.includes("入场时") && desc.includes("每次行动后")) {
    const am = desc.match(/物攻\+(\d+)%/);
    if (am) {
      const v = parseInt(am[1]);
      battler.pctBuffs.phyAtk = Math.min(200, battler.pctBuffs.phyAtk + v);
      events.push({ description: `${label}特性：物攻+${v}%`, side });
    }
  }

  // === 小偷小摸/大捞一笔: 入场时偷取敌方能量 ===
  if (desc.includes("入场时偷取")) {
    const stealMatch = desc.match(/偷取.*?(\d+)能量/);
    const stealAmount = stealMatch ? parseInt(stealMatch[1]) : 2;
    let totalStolen = 0;
    for (const opp of oppTeam) {
      if (opp.isAlive && opp.energy > 0) {
        const taken = Math.min(stealAmount, opp.energy);
        opp.energy -= taken;
        totalStolen += taken;
      }
    }
    if (totalStolen > 0) {
      battler.energy = Math.min(battler.maxEnergy, battler.energy + totalStolen);
      events.push({ description: `${label}特性：入场偷取${totalStolen}能量`, side });
    }
  }

  // === 渴求: 入场时获得吸血 ===
  if (desc.includes("入场时获得") && desc.includes("吸血")) {
    const ls = desc.match(/获得(\d+)%吸血/);
    if (ls) { battler.lifestealPct = Math.min(100, battler.lifestealPct + parseInt(ls[1])); }
    events.push({ description: `${label}特性：获得吸血`, side });
  }

  // === 水翼推进/水翼飞升/渗透/蒸汽膨胀/身经百炼/拨浪鼓: 团队计数入场buff ===
  if (desc.includes("己方精灵每使用1次") && desc.includes("入场时")) {
    // 水翼飞升: 能耗-1 + 0费技能威力+30%
    if (desc.includes("水翼飞升")) {
      battler.skillPowerBonus = (battler.skillPowerBonus || 0) + 30;
      events.push({ description: `${label}特性：水翼飞升`, side });
    }
    if (desc.includes("能耗-")) {
      events.push({ description: `${label}特性：入场能耗降低`, side });
    }
    if (desc.match(/威力\+(\d+)%/)) {
      const pw = parseInt(desc.match(/威力\+(\d+)%/)![1]);
      battler.skillPowerBonus = (battler.skillPowerBonus || 0) + pw;
      events.push({ description: `${label}特性：入场威力+${pw}%`, side });
    }
    if (desc.match(/攻防\+(\d+)%/)) {
      const ad = parseInt(desc.match(/攻防\+(\d+)%/)![1]);
      battler.pctBuffs.phyAtk = Math.min(200, battler.pctBuffs.phyAtk + ad);
      battler.pctBuffs.phyDef = Math.min(200, battler.pctBuffs.phyDef + ad);
      events.push({ description: `${label}特性：攻防+${ad}%`, side });
    }
  }

  // === 拨浪鼓: 己方使用状态技能 → 自己入场毒系萌系+10威 ===
  if (desc.includes("己方精灵每使用1次状态技能") && desc.includes("自己入场")) {
    battler.skillPowerBonus = (battler.skillPowerBonus || 0) + 10;
    events.push({ description: `${label}特性：毒/萌系+10威`, side });
  }

  // === 蓄电池/超级电池: 每入场1次永久双攻+ ===
  if (desc.includes("每入场1次") && desc.includes("双攻+")) {
    const am = desc.match(/双攻.+?(\d+)%/);
    if (am) {
      const v = parseInt(am[1]);
      const entries = battler.entryCount || 0;
      battler.permanentAtkPct = (battler.permanentAtkPct || 0) + v;
      events.push({ description: `${label}特性：第${entries}次入场,永久双攻+${v}%`, side });
    }
  }

  // === 铃兰晚钟: 首次入场失去一半生命 ===
  if (desc.includes("首次入场") && desc.includes("失去")) {
    const loss = Math.floor(battler.currentHp / 2);
    battler.currentHp = Math.max(1, battler.currentHp - loss);
    events.push({ description: `${label}特性：失去${loss}生命`, side });
  }

  // === 魔力系统: 诈死/御驾亲征 ===
  // 诈死: 自己力竭时少损失1点魔力
  // 御驾亲征: 力竭时扣除4魔力 (magicPoints start at 3, deduct on death)
  if (desc.includes("少损失") && desc.includes("魔力")) {
    events.push({ description: `${label}特性：诈死（魔力保护）`, side });
  }
  if (desc.includes("扣除") && desc.includes("魔力")) {
    battler.magicPoints = Math.min(3, (battler.magicPoints || 3));
    events.push({ description: `${label}特性：御驾亲征（${battler.magicPoints}魔力）`, side });
  }

  // === 得寸进尺: 雨天双攻+100% ===
  if (desc.includes("天气为雨天") && desc.includes("双攻+")) {
    events.push({ description: `${label}特性：雨天待机`, side });
  }

  // === 三鼓作气: 3费技能+20%攻防 ===
  if (desc.includes("使用能耗为3的技能") && desc.includes("攻防")) {
    battler.permanentAtkPct = (battler.permanentAtkPct || 0) + 20;
    battler.permanentDefPct = (battler.permanentDefPct || 0) + 20;
    events.push({ description: `${label}特性：3费技能→攻防+20%`, side });
  }

  // === 消波块: 水→地减费 ===
  if (desc.includes("每携带1个") && desc.includes("进入战斗") && desc.includes("能耗-1")) {
    events.push({ description: `${label}特性：跨系减费`, side });
  }

  // === 哨兵/先知/预警: 回合开始时若敌方足够击败自己===
  if ((desc.includes("回合开始时") || desc.includes("先知") || desc.includes("预警")) && desc.includes("速度+")) {
    const sm = desc.match(/速度\+(\d+)/);
    if (sm) battler.statStages.spd = Math.min(6, battler.statStages.spd + 1);
    events.push({ description: `${label}特性：预判速度+`, side });
    // 先知: also +双攻
    if (desc.includes("双攻+")) {
      battler.pctBuffs.phyAtk = Math.min(200, battler.pctBuffs.phyAtk + 50);
      battler.pctBuffs.magAtk = Math.min(200, battler.pctBuffs.magAtk + 50);
    }
  }

  // === 魔术帽: 巧变同系别技能 ===
  if (desc.includes("魔术帽") || desc.includes("巧变")) {
    events.push({ description: `${label}特性：巧变`, side });
  }

  // === 正位宝剑: 仅可使用1号位技能 ===
  if (desc.includes("仅可以使用1号位技能")) {
    if (battler.moveSlots.length > 1) battler.moveSlots = [battler.moveSlots[0]];
    events.push({ description: `${label}特性：仅可1号位`, side });
  }

  // === 多人宿舍: 能量上限突破 ===
  if (desc.includes("能量可以超过能量上限")) {
    battler.maxEnergy = 15;
    events.push({ description: `${label}特性：能量上限15`, side });
  }

  // === 起飞加速: 首次技能获得迅捷 ===
  if (desc.includes("首次使用的技能获得迅捷") || desc.includes("本场战斗首次使用的技能获得迅捷")) {
    battler.firstActionUsed = false;
    events.push({ description: `${label}特性：首次迅捷`, side });
  }

  // === 防范过载: 每次行动后脱离 ===
  if (desc.includes("每次行动后脱离")) {
    events.push({ description: `${label}特性：行动后脱离`, side });
  }

  // === 无差别过滤: 连击数固定为2 ===
  if (desc.includes("连击数固定为2")) {
    battler.comboModifier = 2;
    events.push({ description: `${label}特性：连击固定2`, side });
  }

  // === 棋契变形链: 应对后回满状态 ===
  if (desc.includes("回满状态") && desc.includes("变为")) {
    events.push({ description: `${label}特性：应对变形`, side });
  }

  // === 盛宴: 低血量吸血100% ===
  if (desc.includes("盛宴") || (desc.includes("生命低于50%") && desc.includes("吸血"))) {
    if (battler.currentHp < battler.maxHp * 0.5) {
      battler.lifestealPct = Math.min(100, battler.lifestealPct + 100);
      events.push({ description: `${label}特性：低血吸血100%`, side });
    }
  }

  // === 展翅: 普通系→翼系 ===
  if (desc.includes("普通系技能变为翼系技能")) {
    events.push({ description: `${label}特性：普→翼`, side });
  }

  // === 守护者: 其他精灵每有1层萌化→入场全技能能耗-1 ===
  if (desc.includes("己方其他精灵每有1层萌化") && desc.includes("能耗-")) {
    const otherRegression = team.filter(b => b !== battler).reduce((s, b) => s + (b.regressionLayers || 0), 0);
    if (otherRegression > 0) {
      const cr = parseInt(desc.match(/能耗-(\d+)/)![1]) * otherRegression;
      battler.dedicationCount = (battler.dedicationCount || 0) + cr;
      events.push({ description: `${label}特性：萌化${otherRegression}层→能耗-${cr}`, side });
    }
  }

  // === 噼啪!: 入场后首次行动所选技能使用次数+1 (double combo) ===
  if (desc.includes("入场后首次行动") && desc.includes("使用次数+1")) {
    battler.overloadStacks = (battler.overloadStacks || 0) + 1;
    events.push({ description: `${label}特性：首次行动×2`, side });
  }

  // === 图书守卫/构装契约: 魔力值判定→buff ===
  if ((desc.includes("魔力值为1") || desc.includes("魔力值") && desc.includes("自己获得")) && desc.includes("双攻+")) {
    const mp = battler.magicPoints || 3;
    if (mp <= 1) {
      const am = desc.match(/双攻\+(\d+)%/);
      if (am) {
        const v = parseInt(am[1]);
        battler.pctBuffs.phyAtk = Math.min(200, battler.pctBuffs.phyAtk + v);
        battler.pctBuffs.magAtk = Math.min(200, battler.pctBuffs.magAtk + v);
        events.push({ description: `${label}特性：魔力≤1→双攻+${v}%`, side });
      }
    }
  }
  if ((desc.includes("魔力值为1") || desc.includes("魔力值") && desc.includes("自己获得")) && desc.includes("双防+")) {
    const mp2 = battler.magicPoints || 3;
    if (mp2 <= 1) {
      const dm = desc.match(/双防\+(\d+)%/);
      if (dm) {
        const v = parseInt(dm[1]);
        battler.pctBuffs.phyDef = Math.min(200, battler.pctBuffs.phyDef + v);
        battler.pctBuffs.magDef = Math.min(200, battler.pctBuffs.magDef + v);
        events.push({ description: `${label}特性：魔力≤1→双防+${v}%`, side });
      }
    }
  }

  // === 张弛有度: 周末双攻+40%, 其他双防+40% ===
  if (desc.includes("周末时") && desc.includes("其他时间")) {
    const day = new Date().getDay();
    const isWeekend = day === 0 || day === 6;
    if (isWeekend) {
      const am = desc.match(/双攻\+(\d+)%/);
      if (am) {
        const v = parseInt(am[1]);
        battler.pctBuffs.phyAtk = Math.min(200, battler.pctBuffs.phyAtk + v);
        battler.pctBuffs.magAtk = Math.min(200, battler.pctBuffs.magAtk + v);
        events.push({ description: `${label}特性：周末双攻+${v}%`, side });
      }
    } else {
      const dm = desc.match(/双防\+(\d+)%/);
      if (dm) {
        const v = parseInt(dm[1]);
        battler.pctBuffs.phyDef = Math.min(200, battler.pctBuffs.phyDef + v);
        battler.pctBuffs.magDef = Math.min(200, battler.pctBuffs.magDef + v);
        events.push({ description: `${label}特性：平日双防+${v}%`, side });
      }
    }
  }

  // === 咕噜球效果 (契约的形状) ===
  applyCaptureBallEffect(battler, oppTeam, side, label, events);
  // === 稀兽花宝血脉效果 ===
  applyBeastBloodlineEffect(battler, oppTeam, side, label, events);
}

// 稀兽花宝血脉入场效果
function applyBeastBloodlineEffect(battler: BattlerState, oppTeam: BattlerState[], side: "my" | "enemy", label: string, events: BattleEvent[]): void {
  const trait = battler.monster.trait;
  if (!trait) return;
  const desc = trait.localized?.zh?.description || trait.description || "";
  if (!desc.includes("稀兽花宝")) return;
  const bl = battler.beastBloodline;
  if (!bl) return;
  const opp = oppTeam.find(o => o.isAlive);
  switch (bl) {
    case "电": battler.statStages.spd = Math.min(6, battler.statStages.spd + 10); events.push({ description: `${label}兽花蕾·电：速度+100`, side }); break;
    case "光": battler.pctBuffs.magAtk = Math.min(200, battler.pctBuffs.magAtk + 80); events.push({ description: `${label}兽花蕾·光：魔攻+80%`, side }); break;
    case "冰": if (opp) { opp.freezeLayers = Math.min(20, opp.freezeLayers + 2); events.push({ description: `${label}兽花蕾·冰：敌方冻结+2`, side }); } break;
    case "普通": battler.skillPowerBonus = (battler.skillPowerBonus || 0) + 40; events.push({ description: `${label}兽花蕾·普通：技能威力+40`, side }); break;
    case "虫": if (opp) { opp.pctBuffs.phyDef = Math.max(-100, opp.pctBuffs.phyDef - 80); events.push({ description: `${label}兽花蕾·虫：敌方物防-80%`, side }); } break;
    case "翼": battler.comboModifier = Math.min(10, battler.comboModifier + 3); events.push({ description: `${label}兽花蕾·翼：连击+3`, side }); break;
    case "幽灵": if (opp) { opp.energy = Math.max(0, opp.energy - 2); events.push({ description: `${label}兽花蕾·幽灵：敌方-2能量`, side }); } break;
    case "草": { const h = Math.round(battler.maxHp * 0.2); battler.currentHp = Math.min(battler.maxHp, battler.currentHp + h); events.push({ description: `${label}兽花蕾·草：回复${h}生命`, side }); } break;
    case "水": battler.dedicationCount = (battler.dedicationCount || 0) + 2; events.push({ description: `${label}兽花蕾·水：全技能能耗-2`, side }); break;
    case "萌": if (opp) { opp.pctBuffs.phyAtk = Math.max(-100, opp.pctBuffs.phyAtk - 60); opp.pctBuffs.magAtk = Math.max(-100, opp.pctBuffs.magAtk - 60); events.push({ description: `${label}兽花蕾·萌：敌方双攻-60%`, side }); } break;
    case "龙": if (opp) { opp.pctBuffs.magDef = Math.max(-100, opp.pctBuffs.magDef - 80); events.push({ description: `${label}兽花蕾·龙：敌方魔防-80%`, side }); } break;
    case "毒": if (opp) { opp.poisonLayers = Math.min(3, opp.poisonLayers + 2); events.push({ description: `${label}兽花蕾·毒：敌方中毒+2`, side }); } break;
    case "地": if (opp) { opp.statStages.spd = Math.max(-6, opp.statStages.spd - 6); opp.comboModifier = Math.max(-5, opp.comboModifier - 3); events.push({ description: `${label}兽花蕾·地：敌方速度-60% 连击-3`, side }); } break;
    case "幻": if (opp) { const sid = side === "my" ? "enemy" : "my"; events.push({ description: `${label}兽花蕾·幻：敌方星陨+2`, side: sid as "my"|"enemy" }); } break;
    case "恶": battler.lifestealPct = Math.min(100, battler.lifestealPct + 50); events.push({ description: `${label}兽花蕾·恶：吸血+50%`, side }); break;
    case "机械": battler.pctBuffs.phyDef = Math.min(200, battler.pctBuffs.phyDef + 60); battler.pctBuffs.magDef = Math.min(200, battler.pctBuffs.magDef + 60); events.push({ description: `${label}兽花蕾·机械：双防+60%`, side }); break;
    case "火": if (opp) { opp.burnLayers = Math.min(3, opp.burnLayers + 6); events.push({ description: `${label}兽花蕾·火：敌方灼烧+6`, side }); } break;
    case "武": battler.pctBuffs.phyAtk = Math.min(200, battler.pctBuffs.phyAtk + 80); events.push({ description: `${label}兽花蕾·武：物攻+80%`, side }); break;
  }
}

// 咕噜球入场效果
function applyCaptureBallEffect(battler: BattlerState, oppTeam: BattlerState[], side: "my" | "enemy", label: string, events: BattleEvent[]): void {
  const trait = battler.monster.trait;
  if (!trait) return;
  const desc = trait.localized?.zh?.description || trait.description || "";
  if (!desc.includes("入场时获得不同效果") && !desc.includes("根据自身的血脉")) return;

  const ball = battler.captureBall || "普通球";
  const isPrism = ball === "棱镜球";
  const half = isPrism ? 0.5 : 1;

  switch (ball) {
    case "普通球": {
      const v = Math.round(5 * half);
      battler.pctBuffs.phyAtk = Math.min(200, battler.pctBuffs.phyAtk + v);
      battler.pctBuffs.magAtk = Math.min(200, battler.pctBuffs.magAtk + v);
      battler.pctBuffs.phyDef = Math.min(200, battler.pctBuffs.phyDef + v);
      battler.pctBuffs.magDef = Math.min(200, battler.pctBuffs.magDef + v);
      battler.pctBuffs.spd = Math.min(200, battler.pctBuffs.spd + v);
      events.push({ description: `${label}咕噜球：攻防速+${v}%`, side });
      break;
    }
    case "高级球": {
      const v = Math.round(10 * half);
      battler.pctBuffs.phyAtk = Math.min(200, battler.pctBuffs.phyAtk + v);
      battler.pctBuffs.magAtk = Math.min(200, battler.pctBuffs.magAtk + v);
      battler.pctBuffs.phyDef = Math.min(200, battler.pctBuffs.phyDef + v);
      battler.pctBuffs.magDef = Math.min(200, battler.pctBuffs.magDef + v);
      battler.pctBuffs.spd = Math.min(200, battler.pctBuffs.spd + v);
      events.push({ description: `${label}咕噜球：攻防速+${v}%`, side });
      break;
    }
    case "国王球": {
      const v = Math.round(15 * half);
      battler.pctBuffs.phyAtk = Math.min(200, battler.pctBuffs.phyAtk + v);
      battler.pctBuffs.magAtk = Math.min(200, battler.pctBuffs.magAtk + v);
      battler.pctBuffs.phyDef = Math.min(200, battler.pctBuffs.phyDef + v);
      battler.pctBuffs.magDef = Math.min(200, battler.pctBuffs.magDef + v);
      battler.pctBuffs.spd = Math.min(200, battler.pctBuffs.spd + v);
      events.push({ description: `${label}咕噜球：攻防速+${v}%`, side });
      break;
    }
    case "美妙球": {
      for (const opp of oppTeam) {
        if (opp.isAlive) {
          opp.pctBuffs.phyAtk = Math.max(-100, opp.pctBuffs.phyAtk - Math.round(15 * half));
          opp.pctBuffs.magAtk = Math.max(-100, opp.pctBuffs.magAtk - Math.round(15 * half));
        }
      }
      battler.skillPowerBonus = (battler.skillPowerBonus || 0) + Math.round(15 * half);
      events.push({ description: `${label}咕噜球：敌方双攻-${Math.round(15*half)}%，自威+${Math.round(15*half)}`, side });
      break;
    }
    case "调温球": {
      for (const opp of oppTeam) {
        if (opp.isAlive) {
          opp.burnLayers = Math.min(3, opp.burnLayers + Math.round(4 * half));
          opp.freezeLayers = Math.min(20, opp.freezeLayers + Math.round(1 * half));
        }
      }
      events.push({ description: `${label}咕噜球：敌方灼烧+${Math.round(4*half)} 冻结+${Math.round(1*half)}`, side });
      break;
    }
    case "光合球": {
      const heal = Math.round(battler.maxHp * 15 * half / 100);
      battler.currentHp = Math.min(battler.maxHp, battler.currentHp + heal);
      battler.pctBuffs.magAtk = Math.min(200, battler.pctBuffs.magAtk + Math.round(20 * half));
      events.push({ description: `${label}咕噜球：回复${heal}生命 魔攻+${Math.round(20*half)}%`, side });
      break;
    }
    case "网兜球": {
      battler.dedicationCount = (battler.dedicationCount || 0) + Math.round(1 * half);
      battler.comboModifier = Math.min(10, battler.comboModifier + Math.round(1 * half));
      events.push({ description: `${label}咕噜球：能耗-${Math.round(1*half)} 连击+${Math.round(1*half)}`, side });
      break;
    }
    case "绝缘球": {
      battler.statStages.spd = Math.min(6, battler.statStages.spd + Math.round(1 * half));
      for (const opp of oppTeam) {
        if (opp.isAlive) opp.poisonLayers = Math.min(3, opp.poisonLayers + Math.round(1 * half));
      }
      events.push({ description: `${label}咕噜球：速度+${Math.round(50*half)} 敌方中毒+${Math.round(1*half)}`, side });
      break;
    }
    case "淘沙球": {
      for (const opp of oppTeam) {
        if (opp.isAlive) {
          opp.statStages.spd = Math.max(-6, opp.statStages.spd - Math.round(1 * half));
          opp.pctBuffs.phyDef = Math.max(-100, opp.pctBuffs.phyDef - Math.round(20 * half));
        }
      }
      battler.comboModifier = Math.max(-5, battler.comboModifier - Math.round(1 * half));
      events.push({ description: `${label}咕噜球：敌方速度-${Math.round(20*half)}% 物防-${Math.round(20*half)}%`, side });
      break;
    }
    case "变幻球": {
      battler.pctBuffs.phyDef = Math.min(200, battler.pctBuffs.phyDef + Math.round(15 * half));
      battler.pctBuffs.magDef = Math.min(200, battler.pctBuffs.magDef + Math.round(15 * half));
      for (const opp of oppTeam) {
        if (opp.isAlive) {
          // Starfall mark applied conceptually
          events.push({ description: `${label}咕噜球：双防+${Math.round(15*half)}% 敌方星陨+${Math.round(1*half)}`, side });
        }
      }
      break;
    }
    case "暗星球": {
      battler.lifestealPct = Math.min(100, battler.lifestealPct + Math.round(15 * half));
      for (const opp of oppTeam) {
        if (opp.isAlive) opp.energy = Math.max(0, opp.energy - Math.round(1 * half));
      }
      events.push({ description: `${label}咕噜球：吸血+${Math.round(15*half)}% 敌方-${Math.round(1*half)}能`, side });
      break;
    }
    case "好战球": {
      battler.pctBuffs.phyAtk = Math.min(200, battler.pctBuffs.phyAtk + Math.round(20 * half));
      for (const opp of oppTeam) {
        if (opp.isAlive) opp.pctBuffs.magDef = Math.max(-100, opp.pctBuffs.magDef - Math.round(20 * half));
      }
      events.push({ description: `${label}咕噜球：物攻+${Math.round(20*half)}% 敌方魔防-${Math.round(20*half)}%`, side });
      break;
    }
    case "捕光球":
      events.push({ description: `${label}咕噜球：无效果`, side });
      break;
    case "棱镜球": {
      // Random effect at half strength
      const allBalls = ["普通球","高级球","国王球","美妙球","调温球","光合球","网兜球","绝缘球","淘沙球","变幻球","暗星球","好战球"];
      const picked = allBalls[Math.floor(Math.random() * allBalls.length)];
      battler.captureBall = picked;
      events.push({ description: `${label}咕噜球：棱镜→${picked}(半效)`, side });
      applyCaptureBallEffect(battler, oppTeam, side, label, events);
      battler.captureBall = "棱镜球";
      break;
    }
    default:
      // 普通球 as fallback
      break;
  }
}

// ── Exit traits (applied when switching out or dying) ──
function applyExitTraits(battler: BattlerState, side: "my" | "enemy", events: BattleEvent[]): void {
  const trait = battler.monster.trait;
  if (!trait) return;
  const desc = trait.localized?.zh?.description || trait.description || "";
  const label = side === "my" ? "我方" : "敌方";

  // 快充/其它: 离场时回复X能量
  if (desc.includes("离场时") && desc.includes("回复") && desc.includes("能量")) {
    const eng = parseInt(desc.match(/回复(\d+)能量/)![1]);
    battler.energy = Math.min(battler.maxEnergy, battler.energy + eng);
    events.push({ description: `${label}特性：离场回复${eng}能量`, side });
  }

  // 吉利丁片/美拉德反应/茶多酚/木桶戏法: 离场后给入场精灵buff
  if (desc.includes("离场后") && desc.includes("更换入场的精灵")) {
    // Store exit buffs on the battler for the next entry to pick up
    battler.dedicationCount = (battler.dedicationCount || 0) + 1;
    events.push({ description: `${label}特性：离场buff传给下只精灵`, side });
  }

  // 洁癖: 离场后增益减益继承
  if (desc.includes("离场后") && desc.includes("继承")) {
    // Mark this battler's state as inheritable
    events.push({ description: `${label}特性：离场继承状态`, side });
  }

  // 珊瑚骨: 敌方离场时自己获得能耗-3
  if (desc.includes("敌方精灵") && desc.includes("退场") || desc.includes("离场时") && desc.includes("自己获得全技能能耗")) {
    const cm = desc.match(/能耗-(\d+)/);
    if (cm) {
      battler.dedicationCount = (battler.dedicationCount || 0) + parseInt(cm[1]);
      events.push({ description: `${label}特性：全技能能耗-${cm[1]}`, side });
    }
  }

  // 做噩梦/下黑手: 敌方离场后给入场精灵debuff (handled by caller)
  if (desc.includes("敌方精灵离场后") && desc.includes("更换入场的精灵")) {
    events.push({ description: `${label}特性：敌方入场触发`, side });
  }
}

// ── End-of-turn traits ──
function applyEndOfTurnTraits(battle: BattleState, events: BattleEvent[]): void {
  for (const side of ["my", "enemy"] as const) {
    const team = side === "my" ? battle.myTeam : battle.enemyTeam;
    const activeIdx = side === "my" ? battle.myActive : battle.enemyActive;
    const battler = team[activeIdx];
    if (!battler || !battler.isAlive) continue;
    const trait = battler.monster.trait;
    if (!trait) continue;
    const desc = trait.localized?.zh?.description || trait.description || "";
    const label = side === "my" ? "我方" : "敌方";

    // 警惕: 能量为0时脱离
    if (desc.includes("能量为0") && desc.includes("脱离")) {
      if (battler.energy === 0) {
        battler.energy = 10;
        events.push({ description: `${label}特性：能量归零脱离`, side });
      }
    }

    // 毒蘑菇/其它偷取: 偷取敌方能量
    if (desc.includes("偷取")) {
      const oppTeam = side === "my" ? battle.enemyTeam : battle.myTeam;
      const oppIdx = side === "my" ? battle.enemyActive : battle.myActive;
      const opp = oppTeam[oppIdx];
      if (opp && opp.isAlive && opp.energy > 0) {
        const steal = desc.match(/偷取.*?(\d+)能量/) ? parseInt(desc.match(/偷取.*?(\d+)能量/)![1]) : 1;
        const actual = Math.min(steal, opp.energy);
        opp.energy -= actual;
        battler.energy = Math.min(battler.maxEnergy, battler.energy + actual);
        events.push({ description: `${label}特性：偷取${actual}能量`, side });
      }
    }

    // 养分内循环/生长: 回复能量或生命
    if (desc.includes("回合结束时") && desc.includes("回复") && !desc.includes("偷取")) {
      const eng = desc.match(/回复(\d+)能量/);
      const hp = desc.match(/回复(\d+)%生命/);
      if (eng) {
        const e = parseInt(eng[1]);
        battler.energy = Math.min(battler.maxEnergy, battler.energy + e);
        events.push({ description: `${label}特性：回复${e}能量`, side });
      }
      if (hp) {
        const h = Math.round(battler.maxHp * parseInt(hp[1]) / 100);
        battler.currentHp = Math.min(battler.maxHp, battler.currentHp + h);
        events.push({ description: `${label}特性：回复${h}生命`, side });
      }
    }

    // 吸积盘: 敌方获得星陨
    if (desc.includes("回合结束时") && desc.includes("星陨")) {
      const oppSide2 = side === "my" ? "enemy" : "my";
      const layers = parseInt(desc.match(/获得(\d+)层星陨/)![1]);
      const existing = battle.marks.find(m => m.name === "starfall" && m.side === oppSide2);
      if (existing) existing.layers += layers;
      else battle.marks.push({ name: "starfall", type: "negative", layers, side: oppSide2 });
      events.push({ description: `${label}特性：敌方获得${layers}层星陨`, side });
    }

    // 蚀刻: 中毒转印记
    if (desc.includes("中毒转化为") && desc.includes("印记")) {
      events.push({ description: `${label}特性：中毒转印记`, side });
    }

    // 特殊清洁/扫拖一体: 驱散印记
    if (desc.includes("驱散")) {
      const oppSide3 = side === "my" ? "enemy" : "my";
      const rm = battle.marks.filter(m => m.side === oppSide3).length;
      if (rm > 0) {
        battle.marks = battle.marks.filter(m => m.side !== oppSide3);
        events.push({ description: `${label}特性：驱散敌方印记`, side: oppSide3 });
      }
    }

    // 合拍: 技能匹配后获得永久buff
    if (desc.includes("合拍")) {
      // Compare last actions
      const lastLog = battle.log[battle.log.length - 1];
      if (lastLog) {
        const myAct = side === "my" ? lastLog.myAction : lastLog.enemyAction;
        const enAct = side === "my" ? lastLog.enemyAction : lastLog.myAction;
        if (myAct && enAct && myAct.type === "move" && enAct.type === "move") {
          let matches = 0;
          if (myAct.move.move_type?.name === enAct.move.move_type?.name) matches++;
          if (myAct.move.move_category === enAct.move.move_category) matches++;
          if (myAct.move.energy_cost === enAct.move.energy_cost) matches++;
          if (matches > 0) {
            battler.permanentAtkPct = (battler.permanentAtkPct || 0) + 20 * matches;
            battler.permanentDefPct = (battler.permanentDefPct || 0) + 20 * matches;
            events.push({ description: `${label}合拍! 物攻/物防永久+${20 * matches}%`, side });
          }
        }
      }
    }

    // 奉献系统: 花精灵/坚韧铠甲/振奋虫心 — 每层给随机buff
    if (desc.includes("奉献")) {
      const layers = desc.match(/(\d+)次/) ? parseInt(desc.match(/(\d+)次/)![1]) : 1;
      battler.dedicationCount = (battler.dedicationCount || 0) + layers;
      // Each 奉献 gives +5% to a random team-wide stat
      const stats = ['phyAtk','magAtk','phyDef','magDef','spd'] as const;
      for (let i = 0; i < layers; i++) {
        const s = stats[Math.floor(Math.random() * stats.length)];
        for (const b of team) {
          if (b.isAlive) b.pctBuffs[s] = Math.min(200, b.pctBuffs[s] + 5);
        }
      }
      events.push({ description: `${label}特性：奉献×${battler.dedicationCount} (+5%随机buff×${layers})`, side });
    }

    // 焰色反应: 灼烧衰减→中毒
    if (desc.includes("灼烧变为") && desc.includes("中毒")) {
      if (battler.burnLayers > 0) {
        battler.poisonLayers = Math.min(3, battler.poisonLayers + battler.burnLayers);
        battler.burnLayers = 0;
        events.push({ description: `${label}特性：灼烧→中毒×${battler.poisonLayers}`, side });
      }
    }

    // 煤渣草: 灼烧衰减→增长
    if (desc.includes("灼烧的衰减变为增长")) {
      if (battler.burnLayers > 0 && battler.burnLayers < 3) {
        battler.burnLayers = Math.min(3, battler.burnLayers + 1);
        events.push({ description: `${label}特性：灼烧增长×${battler.burnLayers}`, side });
      }
    }

    // 冰封: 在场时敌方全技能能耗+1
    if (desc.includes("在场时") && desc.includes("敌方全技能能耗+")) {
      // Apply cost increase to enemy team
      const oppSide2 = side === "my" ? "enemy" : "my";
      events.push({ description: `${label}特性：敌方全技能能耗+1`, side: oppSide2 });
    }

    // 消波块: water→ground cost reduction (in computeDamage)
    // Handled via cost reduction in executeAction

    // 双向光速: 回合结束效果额外触发1次
    if (desc.includes("回合结束时的效果会额外触发1次")) {
      // Re-run end-of-turn effects
      events.push({ description: `${label}特性：回合结束效果×2`, side });
    }

    // 系统发育: 获得能量/生命时分给场下
    if (desc.includes("随机分配给场下的精灵")) {
      events.push({ description: `${label}特性：能量/生命分配`, side });
    }

    // 得寸进尺: 雨天双攻+100%
    if (desc.includes("天气为雨天") && desc.includes("双攻+")) {
      if (battle.weather === "rain") {
        battler.pctBuffs.phyAtk = Math.min(200, battler.pctBuffs.phyAtk + 100);
        battler.pctBuffs.magAtk = Math.min(200, battler.pctBuffs.magAtk + 100);
        events.push({ description: `${label}特性：雨天双攻+100%`, side });
      }
    }

    // 陨落: 双方回合结束效果不触发
    if (desc.includes("回合结束时触发的效果不会触发")) {
      // Skip end-of-turn effects for both sides
    }

    // 安可: 光系后返场 → 强制离场
    if (desc.includes("使用光系技能后") && desc.includes("返场")) {
      const lastLog = battle.log[battle.log.length - 1];
      if (lastLog) {
        const act = side === "my" ? lastLog.myAction : lastLog.enemyAction;
        if (act && act.type === "move" && act.move.move_type?.name === "Light") {
          battler.forceSwitch = true;
          events.push({ description: `${label}特性：光系返场`, side });
        }
      }
    }

    // 防过载保护: 每次行动后强制离场
    if (desc.includes("每次行动后脱离")) {
      battler.forceSwitch = true;
      events.push({ description: `${label}特性：强制脱离`, side });
    }

    // 奔波命: 使用防御后脱离
    if (desc.includes("使用防御技能后") && desc.includes("脱离") && !desc.includes("光系")) {
      const lastLog2 = battle.log[battle.log.length - 1];
      if (lastLog2) {
        const act2 = side === "my" ? lastLog2.myAction : lastLog2.enemyAction;
        if (act2 && act2.type === "move" && act2.move.move_category === "Defense") {
          battler.forceSwitch = true;
          events.push({ description: `${label}特性：防御后脱离`, side });
        }
      }
    }
  }
}

export function resolveTurn(state: BattleState, myAction: Action, enemyAction: Action): BattleState {
  const next = structuredClone(state) as BattleState;
  next.turn += 1;
  const events: BattleEvent[] = [];

  // ── Step 0: 随机技能解析（先于传动）──
  const myActive = next.myTeam[next.myActive];
  const enemyActive = next.enemyTeam[next.enemyActive];
  resolveRandomSkills(myActive, enemyActive, next.myTeam, next.enemyTeam);

  // ── Step 1: 传动位移 ──
  if (myActive.moveSlots.length > 0) {
    myActive.moveSlots = applyTransmission(myActive.moveSlots);
  }
  if (enemyActive.moveSlots.length > 0) {
    enemyActive.moveSlots = applyTransmission(enemyActive.moveSlots);
  }

  if (myAction.type === "switch") {
    applyExitTraits(next.myTeam[next.myActive], "my", events);
    applySwitch(next.myTeam, next.myActive, myAction.toIndex);
    events.push({ description: `我方换上 ${next.myTeam[myAction.toIndex].monster.localized.zh.name}`, side: "my" });
    next.myActive = myAction.toIndex;
    const spiritMark = next.marks.find((m) => m.name === "spirit" && m.side === "my");
    if (spiritMark) {
      next.myTeam[next.myActive].energy = Math.max(0, next.myTeam[next.myActive].energy - 1);
      events.push({ description: `降灵印记: 我方换入精灵-1能量`, side: "my" });
    }
    applyEntryTraits(next.myTeam[next.myActive], next.myTeam, next.enemyTeam, "my", events);
  }
  if (enemyAction.type === "switch") {
    applyExitTraits(next.enemyTeam[next.enemyActive], "enemy", events);
    applySwitch(next.enemyTeam, next.enemyActive, enemyAction.toIndex);
    events.push({ description: `敌方换上 ${next.enemyTeam[enemyAction.toIndex].monster.localized.zh.name}`, side: "enemy" });
    next.enemyActive = enemyAction.toIndex;
    const spiritMark = next.marks.find((m) => m.name === "spirit" && m.side === "enemy");
    if (spiritMark) {
      next.enemyTeam[next.enemyActive].energy = Math.max(0, next.enemyTeam[next.enemyActive].energy - 1);
      events.push({ description: `降灵印记: 敌方换入精灵-1能量`, side: "enemy" });
    }
    applyEntryTraits(next.enemyTeam[next.enemyActive], next.enemyTeam, next.myTeam, "enemy", events);
  }

  const myBattler = next.myTeam[next.myActive];
  const enemyBattler = next.enemyTeam[next.enemyActive];

  // Quick Entry (迅捷): after switching in, immediately use first 迅捷 move
  function applyQuickEntry(battler: BattlerState, label: string, s: "my" | "enemy") {
    if (!battler.isAlive) return;
    // Helper: check if trait grants 迅捷
    const hasTraitQuick = (m: Move): boolean => {
      const t = battler.monster.trait;
      if (!t) return false;
      const td = t.localized?.zh?.description || t.description || "";
      // 起飞加速: first action in battle gets 迅捷
      if ((td.includes("首次使用的技能获得迅捷") || td.includes("本场战斗首次使用的技能获得迅捷")) && !battler.firstActionUsed) return true;
      // 快锤: 能耗<3的技能获得迅捷
      if (td.includes("能耗小于3的技能") && td.includes("迅捷") && m.energy_cost < 3) return true;
      // 暴食: 龙系技能获得迅捷
      if (td.includes("龙系技能获得迅捷") && m.move_type?.name === "Dragon") return true;
      return false;
    };
    const quickMove = battler.moveSlots.find(m => {
      const desc = m.localized?.zh?.description || m.description || "";
      const natural = desc.includes("迅捷");
      const traitGranted = hasTraitQuick(m);
      return (natural || traitGranted) && battler.energy >= m.energy_cost;
    });
    if (!quickMove) return;
    // Execute the quick move
    if (quickMove.move_category === "Physical Attack" || quickMove.move_category === "Magic Attack") {
      const quickSlot = battler.moveSlots.findIndex(m => m.id === quickMove.id);
      const oppBattler = s === "my" ? enemyBattler : myBattler;
      const { damage: qDmg } = computeDamage(battler, oppBattler, quickMove, next.weather, false, next.marks, s, quickSlot);
      oppBattler.currentHp = Math.max(0, oppBattler.currentHp - qDmg);
      if (oppBattler.currentHp <= 0) oppBattler.isAlive = false;
      const qPct = Math.round((qDmg / oppBattler.maxHp) * 100);
      battler.energy -= quickMove.energy_cost;
      events.push({ description: `${label}迅捷 ${quickMove.localized.zh.name} 造成 ${qDmg}(${qPct}%)`, side: s });
    } else if (quickMove.move_category === "Defense") {
      battler.defending = true;
      battler.energy -= quickMove.energy_cost;
      events.push({ description: `${label}迅捷 ${quickMove.localized.zh.name} [防御]`, side: s });
    } else {
      battler.energy -= quickMove.energy_cost;
      events.push({ description: `${label}迅捷 ${quickMove.localized.zh.name} [状态]`, side: s });
    }
  }
  // Quick Entry only on active switches (not passive death-entry)
  if (myAction.type === "switch") { applyQuickEntry(myBattler, "我方", "my"); myBattler.firstActionUsed = true; }
  if (enemyAction.type === "switch") { applyQuickEntry(enemyBattler, "敌方", "enemy"); enemyBattler.firstActionUsed = true; }

  // Reset defending state each turn
  myBattler.defending = false;
  enemyBattler.defending = false;

  const { myCounters, enemyCounters } = isCounterSuccess(myAction, enemyAction);

  // Turn order: counter success > switch > speed
  let myFirst: boolean;
  if (myCounters && !enemyCounters) {
    myFirst = true;
  } else if (enemyCounters && !myCounters) {
    myFirst = false;
  } else if (myAction.type === "switch" || enemyAction.type === "switch") {
    myFirst = true;
  } else {
    myFirst = getEffectiveSpeed(myBattler) >= getEffectiveSpeed(enemyBattler);
  }

  const executeAction = (action: Action, actor: BattlerState, target: BattlerState, side: "my" | "enemy", countered: boolean) => {
    if (action.type === "switch") return;
    if (action.type === "focus") {
      actor.chargedMove = null;
      actor.energy = Math.min(actor.maxEnergy, actor.energy + 5);
      events.push({ description: `${side === "my" ? "我方" : "敌方"}聚能 +5能量 (${actor.energy}/${actor.maxEnergy})`, side });
      return;
    }
    if (action.type === "release") {
      const charged = actor.chargedMove;
      if (!charged) return;
      actor.chargedMove = null;
      const { damage: rawDmg } = computeDamage(actor, target, charged, next.weather, countered, next.marks, side);
      const finalDmg = target.defending ? Math.round(rawDmg * 0.3) : rawDmg;
      target.currentHp = Math.max(0, target.currentHp - finalDmg);
      if (target.currentHp <= 0) target.isAlive = false;
      const pct = Math.round((finalDmg / target.maxHp) * 100);
      const defNote = target.defending ? " [被防御减伤70%]" : "";
      events.push({
        description: `${side === "my" ? "我方" : "敌方"}释放 ${charged.localized.zh.name} 造成 ${finalDmg} 伤害 (${pct}%生命)${countered ? " [应对状态!]" : ""}${defNote}`,
        side,
      });
      // Starfall/星陨 mark: 30 power magic damage per layer (non-Fantasy)
      const releaseTargetSide = side === "my" ? "enemy" : "my";
      const releaseStarfallMark = next.marks.find((m) => m.name === "starfall" && m.side === releaseTargetSide);
      if (releaseStarfallMark && target.isAlive && charged.move_type?.name !== "Fantasy") {
        const starfallDmg = calcDamage(actor.baseStats.magAtk, target.baseStats.magDef, 30 * releaseStarfallMark.layers, 1.0, false);
        const extraDmg = starfallDmg.max;
        target.currentHp = Math.max(0, target.currentHp - extraDmg);
        if (target.currentHp <= 0) target.isAlive = false;
        events.push({ description: `星陨印记引爆(${releaseStarfallMark.layers}层): ${releaseTargetSide === "my" ? "我方" : "敌方"}-${extraDmg}生命`, side: releaseTargetSide });
      }
      return;
    }
    const move = action.move;
    // Non-release action clears any stored charge
    if (isChargeMove(move)) {
      actor.chargedMove = move;
    } else {
      actor.chargedMove = null;
    }
    // Moisture/湿润 mark reduces cost by 1 per layer
    const moistureMark = next.marks.find((m) => m.name === "moisture" && m.side === side);
    const moistureReduction = moistureMark ? moistureMark.layers : 0;
    // 嫉妒: 蓄力状态下可用任意技能 → 绕过蓄力检查
    if (isChargeMove(move) && descHasTrait(actor.monster, "蓄力状态下") && descHasTrait(actor.monster, "可以使用任一")) {
      actor.chargedMove = null; // Clear charge state, allow any skill
      events.push({ description: `${side === "my" ? "我方" : "敌方"}特性：蓄力自由`, side });
    }
    // 盲从 (帅帅魔偶): 非幻系技能能耗-2
    const blindObeyReduction = getBlindObeyCostReduction(actor.monster, move);
    // 缩壳: 携带的防御技能能耗-2
    const shellReduction = (move.move_category === "Defense" && descHasTrait(actor.monster, "携带的防御技能能耗-2")) ? 2 : 0;
    // 消波块: 每携带1个水系→地系能耗-1
    let waveReduction = 0;
    if (descHasTrait(actor.monster, "每携带1个") && descHasTrait(actor.monster, "进入战斗") && descHasTrait(actor.monster, "能耗-")) {
      const wvMatch = actor.monster.trait?.localized?.zh?.description?.match(/每携带1个(\S+)系技能进入战斗[，,]\s*(\S+)系技能能耗-(\d+)/);
      if (wvMatch) {
        const carryType = types.find(t => t.localized.zh === wvMatch[1]);
        const affectType = types.find(t => t.localized.zh === wvMatch[2]);
        if (carryType && affectType && move.move_type?.name === affectType.name) {
          const carryCount = actor.moveSlots.filter(m => m.move_type?.name === carryType.name).length;
          waveReduction = carryCount * parseInt(wvMatch[3]);
        }
      }
    }
    const costReduction = moistureReduction + blindObeyReduction + shellReduction + waveReduction;
    // Narrative/蓄势 mark increases cost by 1 for attack moves
    const narrativeMark = next.marks.find((m) => m.name === "narrative" && m.side === side);
    const costIncrease = (narrativeMark && (move.move_category === "Physical Attack" || move.move_category === "Magic Attack")) ? 1 : 0;
    // Sandstorm: ground-type moves cost halved
    const sandstormReduction = (next.weather === "sandstorm" && move.move_type?.name === "Ground") ? Math.floor(move.energy_cost / 2) : 0;
    // Slot position cost reduction (传动 system)
    const slotIdx = actor.moveSlots.findIndex(m => m.id === move.id);
    const slotCostReduction = slotIdx >= 0 ? getSlotBonus(move, slotIdx).costReduction : 0;
    let costDelta = costReduction + sandstormReduction + slotCostReduction - costIncrease;
    // 对流: 能耗增减反转
    if (descHasTrait(actor.monster, "能耗增加变为能耗降低") && descHasTrait(actor.monster, "能耗降低变为能耗增加")) {
      costDelta = -costDelta;
    }
    // 倾轧: 受能耗变化效果的影响翻倍
    if (descHasTrait(actor.monster, "能耗变化效果的影响翻倍")) {
      costDelta *= 2;
    }
    let actualCost = Math.max(0, move.energy_cost - costDelta);
    // 石头大餐: 能量不足时，消耗5%生命代替1能量
    let hpCost = 0;
    if (actualCost > actor.energy && descHasTrait(actor.monster, "能量不足时") && descHasTrait(actor.monster, "消耗") && descHasTrait(actor.monster, "生命代替")) {
      const missing = actualCost - actor.energy;
      const hpMatch = descHasTrait(actor.monster, "消耗(\d+)%生命") ? actor.monster.trait?.localized?.zh?.description?.match(/消耗(\d+)%/) : null;
      const hpPct = hpMatch ? parseInt(hpMatch[1]) : 5;
      hpCost = Math.round(actor.maxHp * hpPct / 100) * missing;
      actor.currentHp = Math.max(1, actor.currentHp - hpCost);
      actor.energy = 0;
      events.push({ description: `${side === "my" ? "我方" : "敌方"}石头大餐：消耗${hpCost}生命代替${missing}能量`, side });
    } else {
      actor.energy -= actualCost;
    }

    if (move.move_category === "Defense") {
      actor.defending = true;
      actor.defenseCooldown = 2;
      if (countered) {
        events.push({ description: `${side === "my" ? "我方" : "敌方"}使用 ${move.localized.zh.name} [应对攻击成功! 减伤70%] (-${actualCost}能量)`, side });
      } else {
        events.push({ description: `${side === "my" ? "我方" : "敌方"}使用 ${move.localized.zh.name} [防御] (-${actualCost}能量)`, side });
      }
    } else if (move.move_category === "Status") {
      if (countered) {
        events.push({ description: `${side === "my" ? "我方" : "敌方"}使用 ${move.localized.zh.name} [应对防御成功! 效果增强] (-${actualCost}能量)`, side });
      } else {
        events.push({ description: `${side === "my" ? "我方" : "敌方"}使用 ${move.localized.zh.name} [状态] (-${actualCost}能量)`, side });
      }
    } else if (move.move_category === "Physical Attack" || move.move_category === "Magic Attack") {
      if (isChargeMove(move)) {
        events.push({ description: `${side === "my" ? "我方" : "敌方"}使用 ${move.localized.zh.name} [蓄力中] (-${actualCost}能量)`, side });
      } else {
        const moveSlotIdx = actor.moveSlots.findIndex(m => m.id === move.id);
        const baseCombo = getComboCount(move);
        // Overload: double the combo count, consume 1 stack
        const hasOverload = actor.overloadStacks > 0;
        const comboCount = Math.max(1, baseCombo + actor.comboModifier) * (hasOverload ? 2 : 1);
        if (hasOverload) {
          actor.overloadStacks -= 1;
          events.push({ description: `${side === "my" ? "我方" : "敌方"}过载: 技能释放×2`, side });
        }
        const defNote = target.defending ? " [被防御减伤70%]" : "";
        let totalDmg = 0;
        let maxPct = 0;

        // Combo loop
        for (let hit = 0; hit < comboCount; hit++) {
          if (!target.isAlive) break;
          const { damage: rawDmg } = computeDamage(actor, target, move, next.weather, countered, next.marks, side, moveSlotIdx);
          let dmg = target.defending ? Math.round(rawDmg * 0.3) : rawDmg;
          target.currentHp = Math.max(0, target.currentHp - dmg);
          totalDmg += dmg;
          maxPct = Math.max(maxPct, Math.round((rawDmg / target.maxHp) * 100));
          if (target.currentHp <= 0) target.isAlive = false;
        }
        const totalPct = Math.round((totalDmg / target.maxHp) * 100);
        const comboLabel = comboCount > 1 ? `×${comboCount}` : "";
        events.push({
          description: `${side === "my" ? "我方" : "敌方"}使用 ${move.localized.zh.name}${comboLabel} 造成 ${totalDmg} 伤害 (${totalPct}%生命)${countered ? " [应对状态!]" : ""}${defNote} (-${actualCost}能量)`,
          side,
        });

        // Dragon mark: after using 3-cost move, +1 dual attack
        const hasDragon = next.marks.some((m) => m.name === "dragon" && m.side === side);
        if (hasDragon && move.energy_cost >= 3) {
          actor.statStages.phyAtk = Math.min(6, actor.statStages.phyAtk + 1);
          actor.statStages.magAtk = Math.min(6, actor.statStages.magAtk + 1);
          events.push({ description: `${side === "my" ? "我方" : "敌方"}龙之印记: 双攻+1`, side });
        }

        // Starfall/星陨 mark: 30 power magic damage per layer (non-Fantasy)
        const targetSide = side === "my" ? "enemy" : "my";
        const starfallMark = next.marks.find((m) => m.name === "starfall" && m.side === targetSide);
        if (starfallMark && target.isAlive && move.move_type?.name !== "Fantasy") {
          const starfallDmg = calcDamage(actor.baseStats.magAtk, target.baseStats.magDef, 30 * starfallMark.layers, 1.0, false);
          const extraDmg = starfallDmg.max;
          target.currentHp = Math.max(0, target.currentHp - extraDmg);
          if (target.currentHp <= 0) target.isAlive = false;
          events.push({ description: `星陨印记引爆(${starfallMark.layers}层): ${targetSide === "my" ? "我方" : "敌方"}-${extraDmg}生命`, side: targetSide });
        }

        // Apply move side effects (once, not per hit)
        const sideEffects = parseMoveEffects(move);
        for (const eff of sideEffects) {
          const targetLabel = targetSide === "my" ? "我方" : "敌方";
          if (eff.type === "burn") {
            target.burnLayers = Math.min(3, target.burnLayers + eff.layers);
            events.push({ description: `${targetLabel}获得灼烧×${target.burnLayers}`, side: targetSide as "my" | "enemy" });
          } else if (eff.type === "freeze") {
            target.freezeLayers = Math.min(20, target.freezeLayers + eff.layers);
            events.push({ description: `${targetLabel}获得冰冻×${target.freezeLayers}`, side: targetSide as "my" | "enemy" });
          } else if (eff.type === "poison") {
            target.poisonLayers = Math.min(3, target.poisonLayers + eff.layers);
            events.push({ description: `${targetLabel}获得中毒×${target.poisonLayers}`, side: targetSide as "my" | "enemy" });
          } else if (eff.type === "statUp") {
            actor.statStages[eff.stat] = Math.min(6, actor.statStages[eff.stat] + eff.stages);
            events.push({ description: `${side === "my" ? "我方" : "敌方"}${STAT_KEY_ZH[eff.stat]}+${eff.stages}`, side });
          } else if (eff.type === "statDown") {
            target.statStages[eff.stat] = Math.max(-6, target.statStages[eff.stat] - eff.stages);
            events.push({ description: `${targetLabel}${STAT_KEY_ZH[eff.stat]}-${eff.stages}`, side: targetSide as "my" | "enemy" });
          } else if (eff.type === "pctBuff") {
            actor.pctBuffs[eff.stat] = Math.max(-100, Math.min(200, actor.pctBuffs[eff.stat] + eff.value));
            const sign = eff.value > 0 ? "+" : "";
            events.push({ description: `${side === "my" ? "我方" : "敌方"}${STAT_KEY_ZH[eff.stat]}${sign}${eff.value}% (${actor.pctBuffs[eff.stat]}%)`, side });
          } else if (eff.type === "applyMark") {
            const markSide = eff.onSelf ? side : (side === "my" ? "enemy" : "my");
            const existing = next.marks.findIndex((m) => m.name === eff.mark && m.side === markSide);
            if (existing >= 0) {
              next.marks[existing].layers += eff.layers;
            } else {
              next.marks.push({ name: eff.mark, type: MARK_INFO[eff.mark].type, layers: eff.layers, side: markSide });
            }
            const markLabel = markSide === "my" ? "我方" : "敌方";
            events.push({ description: `${markLabel}获得${eff.layers}层${MARK_INFO[eff.mark].zh}印记`, side: markSide as "my" | "enemy" });
          } else if (eff.type === "heal") {
            const heal = Math.round(actor.maxHp * eff.percent / 100);
            actor.currentHp = Math.min(actor.maxHp, actor.currentHp + heal);
            events.push({ description: `${side === "my" ? "我方" : "敌方"}回复${heal}生命`, side });
          } else if (eff.type === "recoverEnergy") {
            actor.energy = Math.min(actor.maxEnergy, actor.energy + eff.amount);
            events.push({ description: `${side === "my" ? "我方" : "敌方"}回复${eff.amount}能量 (${actor.energy}/${actor.maxEnergy})`, side });
          } else if (eff.type === "lifesteal") {
            actor.lifestealPct = Math.min(100, actor.lifestealPct + eff.percent);
            events.push({ description: `${side === "my" ? "我方" : "敌方"}获得${eff.percent}%吸血 (${actor.lifestealPct}%)`, side });
          } else if (eff.type === "regress") {
            target.regressionLayers = Math.min(5, target.regressionLayers + eff.layers);
            events.push({ description: `${targetLabel}萌化×${target.regressionLayers}`, side: targetSide as "my" | "enemy" });
            // Find previous evolution from chain data
            const prevId = evoPrevMap[String(target.monster.id)];
            if (prevId) {
              const prevMon = evoDetailMap.get(prevId);
              if (prevMon) {
                const hpRatio2 = target.currentHp / target.maxHp;
                const defPers = { id:0, name:'Neutral', localized:{zh:'平衡'}, hp_mod_pct:0, phy_atk_mod_pct:0, mag_atk_mod_pct:0, phy_def_mod_pct:0, mag_def_mod_pct:0, spd_mod_pct:0 };
                const prevStats = calcStats(prevMon, defPers, DEFAULT_TALENT);
                target.monster = prevMon;
                target.baseStats = prevStats;
                target.maxHp = prevStats.hp;
                target.currentHp = Math.max(1, Math.round(prevStats.hp * hpRatio2));
                target.isLeader = false;
                target.originalMonster = null;
                target.moveSlots = (prevMon.move_pool || []).slice(0, 4);
                events.push({ description: `${targetLabel}退化至${prevMon.localized.zh.name}`, side: targetSide as "my" | "enemy" });
              }
            } else if (target.isLeader && target.originalMonster) {
              // Fallback: revert leader form
              const hpRatio3 = target.currentHp / target.maxHp;
              const defPers = { id:0, name:'Neutral', localized:{zh:'平衡'}, hp_mod_pct:0, phy_atk_mod_pct:0, mag_atk_mod_pct:0, phy_def_mod_pct:0, mag_def_mod_pct:0, spd_mod_pct:0 };
              const origStats2 = calcStats(target.originalMonster, defPers, DEFAULT_TALENT);
              target.monster = target.originalMonster;
              target.baseStats = origStats2;
              target.maxHp = origStats2.hp;
              target.currentHp = Math.max(1, Math.round(origStats2.hp * hpRatio3));
              target.isLeader = false;
              target.originalMonster = null;
              events.push({ description: `${targetLabel}首领形态退化`, side: targetSide as "my" | "enemy" });
            }
          } else if (eff.type === "stun") {
            target.stunned = true;
            events.push({ description: `${targetLabel}获得眩晕`, side: targetSide as "my" | "enemy" });
          } else if (eff.type === "dispelMarks") {
            const dispelSide = (side === "my" ? "enemy" : "my") as "my" | "enemy";
            const removedCount = next.marks.filter(m => m.side === dispelSide).length;
            next.marks = next.marks.filter(m => m.side !== dispelSide);
            events.push({ description: `驱散${dispelSide === "my" ? "我方" : "敌方"}${removedCount}个印记`, side });
          } else if (eff.type === "setWeather") {
            next.weather = eff.weather;
            const wName = eff.weather === "rain" ? "雨天" : eff.weather === "sandstorm" ? "沙暴" : "暴风雪";
            events.push({ description: `天气变为${wName}`, side });
          } else if (eff.type === "comboMod") {
            const comboBattler = eff.onSelf ? actor : target;
            const comboSide = eff.onSelf ? side : (side === "my" ? "enemy" : "my");
            comboBattler.comboModifier = Math.max(-5, Math.min(10, comboBattler.comboModifier + eff.amount));
            const sign = eff.amount > 0 ? "+" : "";
            events.push({ description: `${comboSide === "my" ? "我方" : "敌方"}连击数${sign}${eff.amount}`, side });
          } else if (eff.type === "teamShift") {
            // 过山车：全队技能跨精灵向下移动1位
            const shiftTeam = side === "my" ? next.myTeam : next.enemyTeam;
            applyTeamShift(shiftTeam);
            events.push({ description: `${side === "my" ? "我方" : "敌方"}过山车: 全队技能移位`, side });
          }
        }

        // Apply lifesteal healing on hit
        if (actor.lifestealPct > 0 && totalDmg > 0) {
          const stealHeal = Math.round(totalDmg * actor.lifestealPct / 100);
          actor.currentHp = Math.min(actor.maxHp, actor.currentHp + stealHeal);
          events.push({ description: `${side === "my" ? "我方" : "敌方"}吸血回复${stealHeal}生命`, side });
        }

        // Trait effects on attack hit
        applyTraitOnAttack(actor, target, move, side, events, side === "my" ? "enemy" : "my");
      }
    }
  };

  function applyTraitOnAttack(
    actor: BattlerState, target: BattlerState, move: Move,
    side: "my" | "enemy",
    events: BattleEvent[], targetSide: "my" | "enemy"
  ) {
    if (!actor.isAlive || !target.isAlive) return;
    const trait = actor.monster.trait;
    if (!trait) return;
    const desc = trait.localized?.zh?.description || trait.description || "";

    const moveType = move.move_type?.name || "";
    const isFaster = getEffectiveSpeed(actor) >= getEffectiveSpeed(target);

    const defTypes: TypeInfo[] = [getTypeInfo(target.monster.main_type.name)!].filter(Boolean);
    if (target.monster.sub_type) { const st = getTypeInfo(target.monster.sub_type.name); if (st) defTypes.push(st); }
    const typeEff = moveType ? getTypeEffectiveness(moveType, defTypes) : 1;

    // Pattern 1: "造成克制伤害后" → after super-effective damage
    if (typeEff > 1 && desc.includes("造成克制伤害后")) {
      const pctMatch = desc.match(/攻防速\+(\d+)%/);
      const energyMatch = desc.match(/回复(\d+)能量/);
      if (pctMatch) {
        const val = parseInt(pctMatch[1]);
        actor.pctBuffs.phyAtk = Math.min(200, actor.pctBuffs.phyAtk + val);
        actor.pctBuffs.magAtk = Math.min(200, actor.pctBuffs.magAtk + val);
        actor.pctBuffs.phyDef = Math.min(200, actor.pctBuffs.phyDef + val);
        actor.pctBuffs.magDef = Math.min(200, actor.pctBuffs.magDef + val);
        actor.pctBuffs.spd = Math.min(200, actor.pctBuffs.spd + val);
        events.push({ description: `${side === "my" ? "我方" : "敌方"}特性：攻防速+${val}%`, side });
      }
      if (energyMatch) {
        const eng = parseInt(energyMatch[1]);
        actor.energy = Math.min(actor.maxEnergy, actor.energy + eng);
        events.push({ description: `${side === "my" ? "我方" : "敌方"}特性：回复${eng}能量`, side });
      }
    }

    // Pattern 2: "若先于敌方攻击" → when attacking first
    if (isFaster && desc.includes("若先于敌方攻击")) {
      const powerMatch = desc.match(/威力\+(\d+)%/);
      if (powerMatch) {
        events.push({ description: `${side === "my" ? "我方" : "敌方"}特性：先手威力+${powerMatch[1]}%`, side });
      }
    }

    // Pattern 0: "携带的技能威力+50%" / "防御技能能耗-2" — passive
    if (desc.includes("携带") && desc.includes("技能") && desc.includes("威力") && move.power) {
      const pwMatch = desc.match(/威力\+(\d+)%/);
      if (pwMatch) {
        events.push({ description: `${side === "my" ? "我方" : "敌方"}特性：技能威力+${pwMatch[1]}%`, side });
      }
    }
    // 挺起胸脯: already handled in computeDamage via costPowerMod

    // Pattern 1b: "使敌方获得冻结时，也会使其获得2层冻结。" — freeze stacking
    if (desc.includes("使敌方获得冻结") && desc.includes("也会使其获得")) {
      const extraMatch = desc.match(/获得(\d+)层冻结/);
      if (extraMatch && target.freezeLayers > 0) {
        const extra = parseInt(extraMatch[1]);
        target.freezeLayers = Math.min(20, target.freezeLayers + extra);
        events.push({ description: `${side === "my" ? "我方" : "敌方"}特性：额外冻结+${extra}`, side });
      }
    }

    // Pattern 4: "主动击败敌方精灵时，自己获得双攻+50%。"
    if (!target.isAlive && desc.includes("主动击败敌方") && desc.includes("双攻+")) {
      const koPct = desc.match(/双攻\+(\d+)%/);
      if (koPct) {
        const val = parseInt(koPct[1]);
        actor.pctBuffs.phyAtk = Math.min(200, actor.pctBuffs.phyAtk + val);
        actor.pctBuffs.magAtk = Math.min(200, actor.pctBuffs.magAtk + val);
        events.push({ description: `${side === "my" ? "我方" : "敌方"}特性：击败敌方,双攻+${val}%`, side });
      }
    }

    // Pattern 3: "使用X系技能后" → type-specific
    const typeUseMatch = desc.match(/使用(\S+)系技能[后时]/);
    if (typeUseMatch) {
      const triggerType = typeUseMatch[1];
      const typeInfo = types.find(t => t.localized.zh === triggerType || t.name === triggerType);
      if (typeInfo && moveType === typeInfo.name) {
        // 双攻+
        const atkMatch = desc.match(/双攻\+(\d+)%/);
        if (atkMatch) {
          const val = parseInt(atkMatch[1]);
          actor.pctBuffs.phyAtk = Math.min(200, actor.pctBuffs.phyAtk + val);
          actor.pctBuffs.magAtk = Math.min(200, actor.pctBuffs.magAtk + val);
          events.push({ description: `${side === "my" ? "我方" : "敌方"}特性：双攻+${val}%`, side });
        }
        // 全技能能耗-X
        const costMatch = desc.match(/全技能能耗-(\d+)/);
        if (costMatch) {
          events.push({ description: `${side === "my" ? "我方" : "敌方"}特性：全技能能耗-${costMatch[1]}`, side });
        }
        // 回复生命
        const hpMatch = desc.match(/回复(\d+)%生命/);
        if (hpMatch) {
          const heal = Math.round(actor.maxHp * parseInt(hpMatch[1]) / 100);
          actor.currentHp = Math.min(actor.maxHp, actor.currentHp + heal);
          events.push({ description: `${side === "my" ? "我方" : "敌方"}特性：回复${heal}生命`, side });
        }
        // 敌方获得中毒
        if (desc.includes("敌方获得2层中毒")) {
          target.poisonLayers = Math.min(3, target.poisonLayers + 2);
          events.push({ description: `${targetSide === "my" ? "我方" : "敌方"}特性：获得中毒×${target.poisonLayers}`, side: targetSide });
        }
        // 溶解扩散: 每携带1个毒系技能，水系技能使敌方获得1层中毒
        if (desc.includes("每携带1个") && desc.includes("中毒")) {
          const dissolveType = desc.match(/每携带1个(\S+)系/)![1];
          const waterType = desc.match(/(\S+)系技能使敌方/)![1];
          const dissolveInfo = types.find(t => t.localized.zh === dissolveType);
          const waterInfo = types.find(t => t.localized.zh === waterType);
          if (dissolveInfo && waterInfo && moveType === waterInfo.name) {
            // Count how many dissolve-type moves the actor carries
            const count = actor.moveSlots.filter(m => m.move_type?.name === dissolveInfo.name).length;
            if (count > 0) {
              target.poisonLayers = Math.min(3, target.poisonLayers + count);
              events.push({ description: `${targetSide === "my" ? "我方" : "敌方"}溶解扩散：获得中毒×${target.poisonLayers}（${count}个${dissolveType}系技能）`, side: targetSide });
            }
          }
        }
        // 中毒层数通用
        const poisonMatch = desc.match(/敌方获得(\d+)层中毒/);
        if (poisonMatch && !desc.includes("敌方获得2层中毒") && !desc.includes("每携带1个")) {
          const pl = parseInt(poisonMatch[1]);
          target.poisonLayers = Math.min(3, target.poisonLayers + pl);
          events.push({ description: `${targetSide === "my" ? "我方" : "敌方"}特性：获得中毒×${target.poisonLayers}`, side: targetSide });
        }
        // 连击数+
        const comboMatch2 = desc.match(/连击数\+(\d+)/);
        if (comboMatch2) {
          const cmb = parseInt(comboMatch2[1]);
          actor.comboModifier = Math.min(10, actor.comboModifier + cmb);
          events.push({ description: `${side === "my" ? "我方" : "敌方"}特性：连击数+${cmb}`, side });
        }
      }
    }

    // Pattern 5: 咔咔冲刺 — 若先于敌方行动，行动后获得连击数+1
    if (isFaster && desc.includes("若先于敌方行动") && desc.includes("连击数+")) {
      const cm = desc.match(/连击数\+(\d+)/);
      if (cm) {
        actor.comboModifier = Math.min(10, actor.comboModifier + parseInt(cm[1]));
        events.push({ description: `${side === "my" ? "我方" : "敌方"}特性：先手连击数+${cm[1]}`, side });
      }
    }

    // Pattern 6: 嫁祸 — 自己每失去25%生命，连击数+2
    if (desc.includes("每失去") && desc.includes("生命") && desc.includes("连击数+")) {
      const hpLost = 1 - actor.currentHp / actor.maxHp;
      const threshold = parseInt(desc.match(/每失去(\d+)%/)![1]);
      const bonus = parseInt(desc.match(/连击数\+(\d+)/)![1]);
      const stacks = Math.floor(hpLost * 100 / threshold);
      if (stacks > 0) {
        actor.comboModifier = Math.min(10, actor.comboModifier + stacks * bonus);
      }
    }

    // Pattern 7: 自由飘 — 每有1层萌化，获得连击数+2
    if (desc.includes("每有1层萌化") && desc.includes("连击数+")) {
      const cm2 = desc.match(/连击数\+(\d+)/);
      if (cm2 && actor.regressionLayers > 0) {
        actor.comboModifier = Math.min(10, actor.comboModifier + actor.regressionLayers * parseInt(cm2[1]));
      }
    }

    // Pattern 8: 碰瓷 — 使用X系技能后，敌方失去N能量
    if (desc.includes("使用") && desc.includes("技能后") && desc.includes("敌方失去") && desc.includes("能量")) {
      const tMatch8 = desc.match(/使用(\S+)系技能/);
      const eMatch8 = desc.match(/敌方失去(\d+)能量/);
      if (tMatch8 && eMatch8) {
        const trigType = types.find(t => t.localized.zh === tMatch8[1]);
        if (trigType && trigType.name === moveType) {
          target.energy = Math.max(0, target.energy - parseInt(eMatch8[1]));
          events.push({ description: `${targetSide === "my" ? "我方" : "敌方"}特性：失去${eMatch8[1]}能量`, side: targetSide });
        }
      }
    }

    // Pattern 5: Check target's (defender's) traits
    const targetTrait = target.monster.trait;
    if (targetTrait) {
      const tDesc = targetTrait.localized?.zh?.description || targetTrait.description || "";
      // Death save: "受到致命伤害时，获得1层萌化，并免疫此次伤害" (check before isAlive)
      if (tDesc.includes("受到致命伤害时") && tDesc.includes("免疫此次伤害") && target.currentHp <= 0) {
        target.currentHp = 1;
        target.isAlive = true;
        events.push({ description: `${targetSide === "my" ? "我方" : "敌方"}特性：免疫致命伤`, side: targetSide });
      }
      // Thorns: "每受到1次攻击，对攻击自己的精灵造成50威力物理伤害"
      if (target.isAlive) {
        const thornMatch = tDesc.match(/每受到1次攻击[，,]\s*对攻击自己的精灵造成(\d+)威力/);
        if (thornMatch) {
          const thornPower = parseInt(thornMatch[1]);
          const thornDmg = calcDamage(target.baseStats.phyAtk, target.baseStats.phyDef, thornPower, 1.0, false);
          actor.currentHp = Math.max(0, actor.currentHp - thornDmg.max);
          if (actor.currentHp <= 0) actor.isAlive = false;
          events.push({ description: `${targetSide === "my" ? "我方" : "敌方"}特性：反击-${thornDmg.max}生命`, side });
        }
        // 坚韧铠甲: 每受到1次攻击，队伍获得奉献
        if (tDesc.includes("每受到1次攻击") && tDesc.includes("奉献")) {
          events.push({ description: `${targetSide === "my" ? "我方" : "敌方"}特性：队伍获得奉献`, side: targetSide });
        }
      }
    }

    // Pattern 9: 恶魔的晚宴/振奋虫心 — KO trigger buffs
    if (!target.isAlive && desc.includes("主动击败敌方精灵时") || desc.includes("击败敌方精灵时")) {
      const koAtk = desc.match(/双攻\+(\d+)%/);
      if (koAtk) {
        const v = parseInt(koAtk[1]);
        actor.pctBuffs.phyAtk = Math.min(200, actor.pctBuffs.phyAtk + v);
        actor.pctBuffs.magAtk = Math.min(200, actor.pctBuffs.magAtk + v);
        events.push({ description: `${side === "my" ? "我方" : "敌方"}特性：击败敌方,双攻+${v}%`, side });
      }
      if (desc.includes("奉献")) {
        events.push({ description: `${side === "my" ? "我方" : "敌方"}特性：队伍获得奉献`, side });
      }
    }

    // Pattern 10: 仁心/耐活王 — 敌方受到灼烧/中毒伤害时自己回复
    if ((desc.includes("敌方受到灼烧伤害") || desc.includes("敌方受到中毒效果伤害")) && desc.includes("自己回复")) {
      events.push({ description: `${side === "my" ? "我方" : "敌方"}特性：敌方异常→自己回复`, side });
    }

    // Pattern 11: 侵蚀 — 敌方每有1层中毒，连击数+N
    if (desc.includes("每有1层中毒") && desc.includes("连击数+")) {
      const cm20 = desc.match(/连击数\+(\d+)/);
      if (cm20 && target.poisonLayers > 0) {
        actor.comboModifier = Math.min(10, actor.comboModifier + target.poisonLayers * parseInt(cm20[1]));
      }
    }

    // Pattern 12: 毒牙 — 使敌方中毒时附加减益
    if (desc.includes("使敌方获得中毒") && desc.includes("也会使其获得")) {
      const statDown = desc.match(/物攻-(\d+)%/);
      const spdDown = desc.match(/速度-(\d+)/);
      if (target.poisonLayers > 0) {
        if (statDown) {
          target.pctBuffs.phyAtk = Math.max(-100, target.pctBuffs.phyAtk - parseInt(statDown[1]));
          events.push({ description: `${targetSide === "my" ? "我方" : "敌方"}特性：物攻-${statDown[1]}%`, side: targetSide });
        }
        if (spdDown) {
          target.statStages.spd = Math.max(-6, target.statStages.spd - 1);
          events.push({ description: `${targetSide === "my" ? "我方" : "敌方"}特性：速度-${spdDown[1]}`, side: targetSide });
        }
      }
    }

    // Pattern 13: 毒腺 — 低费技能附加大量中毒
    if (desc.includes("使用能耗小于等于") && desc.includes("获得") && desc.includes("层中毒")) {
      const threshold = parseInt(desc.match(/小于等于(\d+)/)![1]);
      const layers = parseInt(desc.match(/获得(\d+)层中毒/)![1]);
      if (move.energy_cost <= threshold) {
        target.poisonLayers = Math.min(3, target.poisonLayers + layers);
        events.push({ description: `${targetSide === "my" ? "我方" : "敌方"}特性：获得中毒×${target.poisonLayers}`, side: targetSide });
      }
    }

    // Pattern 14: 变形活画/坠星 — 敌方每有X层增益/印记，威力+Y%
    if (desc.includes("每有1层") && desc.includes("本次技能威力+")) {
      const pw = desc.match(/威力\+(\d+)%/);
      if (pw) {
        events.push({ description: `${side === "my" ? "我方" : "敌方"}特性：威力提升`, side });
      }
    }

    // Pattern 15: 灵魂灼伤 — 冰系给灼烧，火系给冻结
    if (desc.includes("冰系技能能使敌方获得") && desc.includes("灼烧")) {
      if (moveType === "Ice") {
        target.burnLayers = Math.min(3, target.burnLayers + 4);
        events.push({ description: `${targetSide === "my" ? "我方" : "敌方"}特性：冰系→灼烧×4`, side: targetSide });
      }
      if (moveType === "Fire") {
        target.freezeLayers = Math.min(20, target.freezeLayers + 2);
        events.push({ description: `${targetSide === "my" ? "我方" : "敌方"}特性：火系→冻结×2`, side: targetSide });
      }
    }

    // Pattern 16: 扩散侵蚀 — 水系→中毒层数=印记层数×2
    if (desc.includes("扩散侵蚀")) {
      const poisonMark = next.marks.find(m => m.name === "poison" && m.side === side);
      if (poisonMark && moveType === "Water") {
        const layers = poisonMark.layers * 2;
        target.poisonLayers = Math.min(3, target.poisonLayers + layers);
        events.push({ description: `${targetSide === "my" ? "我方" : "敌方"}扩散侵蚀：中毒×${target.poisonLayers}`, side: targetSide });
      }
    }

    // Pattern 17: 高浓生物碱 — 使用技能时(无系别限制)敌方中毒
    if (desc.includes("高浓生物碱") || (desc.includes("使用技能时") && desc.includes("敌方获得") && desc.includes("中毒") && !desc.match(/使用\S+系技能/) && !desc.includes("草系技能"))) {
      if (desc.includes("敌方获得2层中毒")) {
        target.poisonLayers = Math.min(3, target.poisonLayers + 2);
        events.push({ description: `${targetSide === "my" ? "我方" : "敌方"}特性：中毒×${target.poisonLayers}`, side: targetSide });
      }
    }

    // Pattern 18: 月光审判/缤纷星光/天通地明 — 根据血脉增伤
    if ((desc.includes("血脉是") || desc.includes("血脉是非")) && desc.includes("威力+")) {
      const pw2 = parseInt(desc.match(/威力\+(\d+)%/)![1]);
      events.push({ description: `${side === "my" ? "我方" : "敌方"}特性：血脉克制+${pw2}%威`, side });
    }

    // Pattern 19: 冰钻 — 敌方技能总能耗每1点→威力+10%
    if (desc.includes("敌方携带技能总能耗每有1点")) {
      const opp = side === "my" ? enemyBattler : myBattler;
      if (opp) {
        const total = opp.moveSlots.reduce((s, m) => s + m.energy_cost, 0);
        const pw = parseInt(desc.match(/威力\+(\d+)%/)![1]);
        const bonus = total * pw;
        events.push({ description: `${side === "my" ? "我方" : "敌方"}特性：威力+${bonus}%`, side });
      }
    }

    // Pattern 20: 血型吸引 — 敌方每携带1种系列技能→威力+10%
    if (desc.includes("每携带1种系列的技能")) {
      const uniqueSeries = new Set(target.moveSlots.filter(m => m.move_type).map(m => m.move_type!.name)).size;
      const pw = parseInt(desc.match(/威力\+(\d+)/)![1]) * uniqueSeries;
      events.push({ description: `${side === "my" ? "我方" : "敌方"}特性：威力+${pw}`, side });
    }
  }

  // Interrupt: if counter succeeds and countering move has interrupt, skip countered action
  let mySkipped = false;
  let enemySkipped = false;
  if (myCounters && myAction.type === "move") {
    const myInterrupt = parseMoveEffects(myAction.move).some(e => e.type === "interrupt");
    if (myInterrupt && enemyAction.type === "move") {
      enemySkipped = true;
      enemyBattler.energy = Math.min(enemyBattler.maxEnergy, enemyBattler.energy + enemyAction.move.energy_cost);
      events.push({ description: `我方打断敌方${enemyAction.move.localized.zh.name}！`, side: "my" });
      const mTrait = myBattler.monster.trait;
      if (mTrait) {
        const mtDesc = mTrait.localized?.zh?.description || mTrait.description || "";
        if (mtDesc.includes("打断") && mtDesc.includes("冷却")) {
          events.push({ description: `我方特性：被打断技能进入冷却`, side: "my" });
        }
      }
    }
  }
  if (enemyCounters && enemyAction.type === "move") {
    const enemyInterrupt = parseMoveEffects(enemyAction.move).some(e => e.type === "interrupt");
    if (enemyInterrupt && myAction.type === "move") {
      mySkipped = true;
      myBattler.energy = Math.min(myBattler.maxEnergy, myBattler.energy + myAction.move.energy_cost);
      events.push({ description: `敌方打断我方${myAction.move.localized.zh.name}！`, side: "enemy" });
      // Trait: "打断敌方时，被打断的技能进入2回合冷却"
      const eTrait = enemyBattler.monster.trait;
      if (eTrait) {
        const etDesc = eTrait.localized?.zh?.description || eTrait.description || "";
        if (etDesc.includes("打断") && etDesc.includes("冷却")) {
          events.push({ description: `敌方特性：被打断技能进入冷却`, side: "enemy" });
        }
      }
    }
  }

  // ── Counter success traits: 应对成功后触发 ──
  function applyCounterTraits(battler: BattlerState, side: "my" | "enemy") {
    const t = battler.monster.trait;
    if (!t) return;
    const d = t.localized?.zh?.description || t.description || "";
    const l = side === "my" ? "我方" : "敌方";
    // 圣火骑士: 下次攻击威力翻倍
    if (d.includes("应对成功后") && d.includes("威力翻倍")) {
      battler.skillPowerBonus = (battler.skillPowerBonus || 0) + 100;
      events.push({ description: `${l}特性：下次攻击威力翻倍`, side });
    }
    // 指挥家: 永久双攻+30%
    if (d.includes("应对成功后") && d.includes("永久获得")) {
      const am = d.match(/双攻\+(\d+)%/);
      if (am) {
        const v = parseInt(am[1]);
        battler.permanentAtkPct = (battler.permanentAtkPct || 0) + v;
        events.push({ description: `${l}特性：永久双攻+${v}%`, side });
      }
    }
    // 斗技: 全技能威力永久+N
    if (d.includes("斗技") && d.includes("应对成功")) {
      const pw = d.match(/威力永久\+(\d+)/);
      if (pw) {
        battler.skillPowerBonus = (battler.skillPowerBonus || 0) + parseInt(pw[1]);
        events.push({ description: `${l}特性：全技能威力+${pw[1]}`, side });
      }
    }
    // 野性感官: 下次行动先手+1
    if (d.includes("应对成功后") && d.includes("先手")) {
      battler.statStages.spd = Math.min(6, battler.statStages.spd + 2);
      events.push({ description: `${l}特性：下次行动先手+1`, side });
    }
    // 思维之盾: 下次行动技能能耗-5
    if (d.includes("应对成功后") && d.includes("能耗-5")) {
      battler.dedicationCount = (battler.dedicationCount || 0) + 5;
      events.push({ description: `${l}特性：下次行动能耗-5`, side });
    }

    // 棋契变形: 应对后回满状态→变棋绮后 (attack/defense/status → 腾挪/保卫/好象坏象)
    if (d.includes("回满状态") && d.includes("变为")) {
      const targetName = d.match(/变为(\S+)/)?.[1] || "棋绮后";
      // Search for the target form in the monster pool by name
      const targetMonster = detailMap2.get(battler.monster.id); // Start from current
      if (targetMonster) {
        // Find the evolution chain - look for the form that has higher stats with the target name
        // For now, just heal full and mark as transformed
        battler.currentHp = battler.maxHp;
        battler.burnLayers = 0;
        battler.poisonLayers = 0;
        battler.freezeLayers = 0;
        battler.regressionLayers = 0;
        events.push({ description: `${l}特性：回满并变${targetName}`, side });
      }
    }
  }
  if (myCounters) applyCounterTraits(myBattler, "my");
  if (enemyCounters) applyCounterTraits(enemyBattler, "enemy");

  // Stun check: stunned battler can't act
  if (myBattler.stunned && myAction.type !== "switch") {
    events.push({ description: `我方眩晕，无法行动`, side: "my" });
  }
  if (enemyBattler.stunned && enemyAction.type !== "switch") {
    events.push({ description: `敌方眩晕，无法行动`, side: "enemy" });
  }

  if (myFirst) {
    if (!mySkipped && !myBattler.stunned && myBattler.isAlive) executeAction(myAction, myBattler, enemyBattler, "my", myCounters);
    if (!enemySkipped && !enemyBattler.stunned && enemyBattler.isAlive) executeAction(enemyAction, enemyBattler, myBattler, "enemy", enemyCounters);
  } else {
    if (!enemySkipped && !enemyBattler.stunned && enemyBattler.isAlive) executeAction(enemyAction, enemyBattler, myBattler, "enemy", enemyCounters);
    if (!mySkipped && !myBattler.stunned && myBattler.isAlive) executeAction(myAction, myBattler, enemyBattler, "my", myCounters);
  }

  // End-of-turn: burn damage + layer decay
  if (myBattler.isAlive && myBattler.burnLayers > 0) {
    const dmg = Math.round(myBattler.maxHp * 0.02 * myBattler.burnLayers);
    myBattler.currentHp = Math.max(0, myBattler.currentHp - dmg);
    if (myBattler.currentHp <= 0) myBattler.isAlive = false;
    events.push({ description: `我方灼烧 ${myBattler.burnLayers}层 -${dmg}生命`, side: "my" });
    const decay = Math.max(1, Math.floor(myBattler.burnLayers / 2));
    myBattler.burnLayers = Math.max(0, myBattler.burnLayers - decay);
  }
  if (enemyBattler.isAlive && enemyBattler.burnLayers > 0) {
    const dmg = Math.round(enemyBattler.maxHp * 0.02 * enemyBattler.burnLayers);
    enemyBattler.currentHp = Math.max(0, enemyBattler.currentHp - dmg);
    if (enemyBattler.currentHp <= 0) enemyBattler.isAlive = false;
    events.push({ description: `敌方灼烧 ${enemyBattler.burnLayers}层 -${dmg}生命`, side: "enemy" });
    const decay = Math.max(1, Math.floor(enemyBattler.burnLayers / 2));
    enemyBattler.burnLayers = Math.max(0, enemyBattler.burnLayers - decay);
  }

  // End-of-turn: poison damage (affected by type effectiveness)
  if (myBattler.isAlive && myBattler.poisonLayers > 0) {
    const myDefTypes: TypeInfo[] = [];
    const myMainT = getTypeInfo(myBattler.monster.main_type.name);
    if (myMainT) myDefTypes.push(myMainT);
    if (myBattler.monster.sub_type) { const st = getTypeInfo(myBattler.monster.sub_type.name); if (st) myDefTypes.push(st); }
    const poisonEff = getTypeEffectiveness("Poison", myDefTypes);
    const dmg = Math.max(1, Math.round(myBattler.maxHp * 0.03 * myBattler.poisonLayers * poisonEff));
    myBattler.currentHp = Math.max(0, myBattler.currentHp - dmg);
    if (myBattler.currentHp <= 0) myBattler.isAlive = false;
    events.push({ description: `我方中毒 ${myBattler.poisonLayers}层 -${dmg}生命${poisonEff !== 1 ? ` (×${poisonEff})` : ""}`, side: "my" });
  }
  if (enemyBattler.isAlive && enemyBattler.poisonLayers > 0) {
    const eDefTypes: TypeInfo[] = [];
    const eMainT = getTypeInfo(enemyBattler.monster.main_type.name);
    if (eMainT) eDefTypes.push(eMainT);
    if (enemyBattler.monster.sub_type) { const st = getTypeInfo(enemyBattler.monster.sub_type.name); if (st) eDefTypes.push(st); }
    const poisonEff = getTypeEffectiveness("Poison", eDefTypes);
    const dmg = Math.max(1, Math.round(enemyBattler.maxHp * 0.03 * enemyBattler.poisonLayers * poisonEff));
    enemyBattler.currentHp = Math.max(0, enemyBattler.currentHp - dmg);
    if (enemyBattler.currentHp <= 0) enemyBattler.isAlive = false;
    events.push({ description: `敌方中毒 ${enemyBattler.poisonLayers}层 -${dmg}生命${poisonEff !== 1 ? ` (×${poisonEff})` : ""}`, side: "enemy" });
  }

  // Freeze check
  if (myBattler.isAlive && myBattler.freezeLayers > 0) {
    const freezeThreshold = Math.round(myBattler.maxHp * 0.05 * myBattler.freezeLayers);
    if (myBattler.currentHp <= freezeThreshold) {
      myBattler.currentHp = 0;
      myBattler.isAlive = false;
      events.push({ description: `我方被冰冻击倒 (生命≤${freezeThreshold})`, side: "my" });
    }
  }
  if (enemyBattler.isAlive && enemyBattler.freezeLayers > 0) {
    const freezeThreshold = Math.round(enemyBattler.maxHp * 0.05 * enemyBattler.freezeLayers);
    if (enemyBattler.currentHp <= freezeThreshold) {
      enemyBattler.currentHp = 0;
      enemyBattler.isAlive = false;
      events.push({ description: `敌方被冰冻击倒 (生命≤${freezeThreshold})`, side: "enemy" });
    }
  }

  // Blizzard weather
  if (next.weather === "blizzard") {
    if (myBattler.isAlive && myBattler.monster.main_type.name !== "Ice") {
      myBattler.freezeLayers += 2;
      events.push({ description: `暴风雪: 我方+2层冰冻`, side: "my" });
    }
    if (enemyBattler.isAlive && enemyBattler.monster.main_type.name !== "Ice") {
      enemyBattler.freezeLayers += 2;
      events.push({ description: `暴风雪: 敌方+2层冰冻`, side: "enemy" });
    }
  }

  // Sandstorm: energy cost reduction handled in executeAction (no end-of-turn damage)

  // Mark effects
  for (const mark of next.marks) {
    const battler = mark.side === "my" ? myBattler : enemyBattler;
    if (!battler.isAlive) continue;
    const sideLabel = mark.side === "my" ? "我方" : "敌方";

    if (mark.name === "photosynthesis") {
      battler.energy = Math.min(battler.maxEnergy, battler.energy + mark.layers);
      events.push({ description: `${sideLabel}光合印记: +${mark.layers}能量 (${battler.energy}/${battler.maxEnergy})`, side: mark.side });
    } else if (mark.name === "poison") {
      const mDefTypes: TypeInfo[] = [];
      const mMainT = getTypeInfo(battler.monster.main_type.name);
      if (mMainT) mDefTypes.push(mMainT);
      if (battler.monster.sub_type) { const subType = getTypeInfo(battler.monster.sub_type.name); if (subType) mDefTypes.push(subType); }
      const poisonEff = getTypeEffectiveness("Poison", mDefTypes);
      const dmg = Math.max(1, Math.round(battler.maxHp * 0.03 * poisonEff));
      battler.currentHp = Math.max(0, battler.currentHp - dmg);
      if (battler.currentHp <= 0) battler.isAlive = false;
      events.push({ description: `${sideLabel}中毒印记: -${dmg}生命${poisonEff !== 1 ? ` (×${poisonEff})` : ""}`, side: mark.side });
    }
  }

  // Trait: "回合结束时，若自己能量为0则脱离"
  function checkAutoExit(battler: BattlerState, label: string, s: "my" | "enemy") {
    if (!battler.isAlive || battler.energy > 0) return;
    const t = battler.monster.trait;
    if (!t) return;
    const td = t.localized?.zh?.description || t.description || "";
    if (td.includes("若自己能量为0则脱离")) {
      events.push({ description: `${label}能量为0，特性脱离`, side: s });
      battler.statStages = { ...DEFAULT_STAGES };
      battler.pctBuffs = { ...DEFAULT_PCT_BUFFS };
      battler.lifestealPct = 0;
      battler.comboModifier = 0;
    }
  }
  checkAutoExit(myBattler, "我方", "my");
  checkAutoExit(enemyBattler, "敌方", "enemy");

  // End-of-turn: increment turnsOnField, clear per-turn effects, reduce cooldown
  myBattler.stunned = false;
  enemyBattler.stunned = false;
  if (myBattler.defenseCooldown > 0) myBattler.defenseCooldown -= 1;
  if (enemyBattler.defenseCooldown > 0) enemyBattler.defenseCooldown -= 1;
  myBattler.turnsOnField += 1;
  enemyBattler.turnsOnField += 1;
  if (next.myMagicItemCooldown > 0) next.myMagicItemCooldown -= 1;
  if (next.enemyMagicItemCooldown > 0) next.enemyMagicItemCooldown -= 1;

  // Willpower deactivation: after using 願力冲击, deactivate (usage counted in applyMagicItem)
  if (next.myWillpowerActive &&
      myAction.type === "move" && myAction.move.id === 2) {
    next.myWillpowerActive = false;
  }
  if (next.enemyWillpowerActive &&
      enemyAction.type === "move" && enemyAction.move.id === 2) {
    next.enemyWillpowerActive = false;
  }

  next.log.push({ turn: next.turn, myAction, enemyAction, events });

  if (!myBattler.isAlive) {
    // 魔力扣减
    const myTrait = myBattler.monster.trait;
    if (myTrait) {
      const mtDesc = myTrait.localized?.zh?.description || myTrait.description || "";
      // 诈死: 少损失1点魔力
      if (mtDesc.includes("少损失") && mtDesc.includes("魔力") && next.myMagicPoints > 0) {
        next.myMagicPoints = Math.max(0, next.myMagicPoints - 1);
        events.push({ description: `我方诈死: 消耗1魔力(${next.myMagicPoints}剩余)`, side: "my" });
      }
      if (mtDesc.includes("扣除") && mtDesc.includes("魔力")) {
        next.myMagicPoints = Math.max(0, next.myMagicPoints - 4);
        events.push({ description: `我方御驾亲征: 扣除4魔力(${next.myMagicPoints}剩余)`, side: "my" });
      }
      if (mtDesc.includes("额外损失") && mtDesc.includes("魔力")) {
        next.myMagicPoints = Math.max(0, next.myMagicPoints - 1);
        events.push({ description: `我方特性：额外损失1魔力`, side: "my" });
      }
    }
    events.push({ description: `我方${myBattler.monster.localized.zh.name}力竭！请手动换人`, side: "my" });
  }
  if (!enemyBattler.isAlive) {
    const eTrait = enemyBattler.monster.trait;
    if (eTrait) {
      const etDesc = eTrait.localized?.zh?.description || eTrait.description || "";
      if (etDesc.includes("少损失") && etDesc.includes("魔力") && next.enemyMagicPoints > 0) {
        next.enemyMagicPoints = Math.max(0, next.enemyMagicPoints - 1);
        events.push({ description: `敌方诈死: 消耗1魔力(${next.enemyMagicPoints}剩余)`, side: "enemy" });
      }
      if (etDesc.includes("扣除") && etDesc.includes("魔力")) {
        next.enemyMagicPoints = Math.max(0, next.enemyMagicPoints - 4);
        events.push({ description: `敌方御驾亲征: 扣除4魔力(${next.enemyMagicPoints}剩余)`, side: "enemy" });
      }
    }
    events.push({ description: `敌方${enemyBattler.monster.localized.zh.name}力竭！`, side: "enemy" });
  }

  // ── End-of-turn traits ──
  applyEndOfTurnTraits(next, events);

  // Handle forceSwitch (防过载/安可/奔波命)
  if (myBattler.forceSwitch && myBattler.isAlive) {
    const aliveTeammate = next.myTeam.findIndex((b, i) => i !== next.myActive && b.isAlive);
    if (aliveTeammate >= 0) {
      applySwitch(next.myTeam, next.myActive, aliveTeammate);
      events.push({ description: `我方${myBattler.monster.localized.zh.name}强制脱离`, side: "my" });
      next.myActive = aliveTeammate;
      applyEntryTraits(next.myTeam[aliveTeammate], next.myTeam, next.enemyTeam, "my", events);
    }
    myBattler.forceSwitch = false;
  }
  if (enemyBattler.forceSwitch && enemyBattler.isAlive) {
    const aliveTeammate2 = next.enemyTeam.findIndex((b, i) => i !== next.enemyActive && b.isAlive);
    if (aliveTeammate2 >= 0) {
      applySwitch(next.enemyTeam, next.enemyActive, aliveTeammate2);
      events.push({ description: `敌方${enemyBattler.monster.localized.zh.name}强制脱离`, side: "enemy" });
      next.enemyActive = aliveTeammate2;
      applyEntryTraits(next.enemyTeam[aliveTeammate2], next.enemyTeam, next.myTeam, "enemy", events);
    }
    enemyBattler.forceSwitch = false;
  }

  next.log.push({ turn: next.turn, myAction, enemyAction, events });
  return next;
}

export { stageMultiplier, getEffectiveSpeed };

export function addMark(state: BattleState, mark: Mark): BattleState {
  const next = structuredClone(state) as BattleState;
  const existing = next.marks.findIndex((m) => m.name === mark.name && m.side === mark.side);
  if (existing >= 0) {
    next.marks[existing].layers = mark.layers;
  } else {
    next.marks.push(mark);
  }
  return next;
}

export function removeMark(state: BattleState, name: MarkName, side: "my" | "enemy"): BattleState {
  const next = structuredClone(state) as BattleState;
  next.marks = next.marks.filter((m) => !(m.name === name && m.side === side));
  return next;
}

export function setWeather(state: BattleState, weather: Weather): BattleState {
  return { ...state, weather };
}

export const MARK_INFO: Record<MarkName, { zh: string; type: "positive" | "negative"; desc: string }> = {
  photosynthesis: { zh: "光合", type: "positive", desc: "每回合每层+1能量" },
  moisture: { zh: "湿润", type: "positive", desc: "每层全技能能耗-1" },
  narrative: { zh: "蓄势", type: "positive", desc: "全攻击技能威力+30%，能耗+1" },
  charge: { zh: "蓄电", type: "positive", desc: "入场首回合技能威力+10" },
  dragon: { zh: "龙噬", type: "positive", desc: "释放3能耗技能后双攻+30%" },
  poison: { zh: "中毒", type: "negative", desc: "每回合3%毒属性伤害（受克制影响）" },
  spirit: { zh: "降灵", type: "negative", desc: "精灵入场时每层-1能量" },
  starfall: { zh: "星陨", type: "negative", desc: "非幻系攻击触发，每层30威力魔法伤害" },
};


