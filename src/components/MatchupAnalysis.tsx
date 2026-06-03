import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { Monster, Move } from "../lib/types";
import type { MatchupResult, MoveAnalysis } from "../lib/battle";
import { initBattle, resolveTurn, applyMagicItem, applyInitialTraits, createWillpowerMove, isChargeMove, getComboCount, getTraitEffectLabels, MARK_INFO } from "../lib/simulator";
import type { BattleState, Action, BattlerState, MagicItemId, TeamMemberInput } from "../lib/simulator";
import { TurnCorrectionBar, type Correction } from "./TurnCorrectionBar";
import { TurnTimeline } from "./TurnTimeline";
import { estimateAttackerStats, estimatePersonalityName } from "../lib/damageReverser";
import { appendTurnRecord, getTimeline, replayFromTurn, resetTimeline, overrideTurnAfter } from "../lib/battleTimeline";
import { injectCorrectionMessage } from "../lib/aiSession";
import { recordObservation } from "../lib/observations";
import { getTypeEffectiveness } from "../lib/calculator";
import { getPopularPersonality, getPopularTalent, formatPersonality } from "../lib/popularStats";
import { matchSkillName } from "../lib/pinyinSearch";
import { MonsterSearch } from "./MonsterSearch";
import { MoveSearch } from "./MoveSearch";
import monstersDetail from "../data/monsters_detail.json";
import allMoves from "../data/moves.json";
import { TYPE_COLORS, typeDotBg } from "../lib/typeColors";
import type { TypeInfo } from "../lib/types";
import typesData from "../data/types.json";

const allTypes = (typesData as TypeInfo[]).filter(t => t.name !== "Leader"); // 首领是血脉不是系别

const detailMap = new Map((monstersDetail as Monster[]).map((m) => [m.id, m]));

interface Props {
  matchup: MatchupResult;
  atkSpd: number;
  defSpd: number;
  myDamage: MoveAnalysis[];
  enemyDamage: MoveAnalysis[];
  myTeam: TeamMemberInput[];
  enemyTeam: Monster[];
  myActiveIndex: number;
  enemyActiveIndex: number;
  teamMagicItem: string | null;
  onBattleStateChange?: (battle: BattleState | null) => void;
  onTurnExecuted?: () => void;
  onUndoTurn?: (targetTurn: number) => void;
}

export function MatchupAnalysis({
  matchup, atkSpd, defSpd,
  myDamage, enemyDamage,
  myTeam, enemyTeam, myActiveIndex, enemyActiveIndex,
  teamMagicItem: teamMagicItem,
  onBattleStateChange,
  onTurnExecuted,
  onUndoTurn,
}: Props) {
  const [battle, setBattle] = useState<BattleState | null>(null);
  const [prevBattle, setPrevBattle] = useState<BattleState | null>(null);

  const onBattleStateChangeRef = useRef(onBattleStateChange);
  onBattleStateChangeRef.current = onBattleStateChange;
  const onTurnExecutedRef = useRef(onTurnExecuted);
  onTurnExecutedRef.current = onTurnExecuted;
  useEffect(() => { onBattleStateChangeRef.current?.(battle); }, [battle]);
  const [myAction, setMyAction] = useState<Action | null>(null);
  const [enemyAction, setEnemyAction] = useState<Action | null>(null);
  const [myMoves, setMyMoves] = useState<Move[]>([]);
  const [enemyMoves, setEnemyMoves] = useState<Move[]>([]);
  const [leaderSearchSide, setLeaderSearchSide] = useState<"my" | "enemy" | null>(null);
  const [willpowerPending, setWillpowerPending] = useState<"my" | "enemy" | null>(null);
  const [skillOverrideSlot, setSkillOverrideSlot] = useState<number | null>(null);
  const [skillOverrideType, setSkillOverrideType] = useState<string>("");
  const [enemySkillTypes, setEnemySkillTypes] = useState<Record<number, string>>({});
  // Track which slots have random skills, to revert after turn
  const [randomSlotOriginal, setRandomSlotOriginal] = useState<Record<number, Move>>({});
  const [enemyOverrideSlot, setEnemyOverrideSlot] = useState<number | null>(null);
  // 核对条：执行回合后弹出，1.5s 自动确认或用户修改
  const [correctionBarBattle, setCorrectionBarBattle] = useState<BattleState | null>(null);
  const [correctionPrevBattle, setCorrectionPrevBattle] = useState<BattleState | null>(null);
  // 时间线：用 timelineVersion 作为渲染触发器
  const [timelineVersion, setTimelineVersion] = useState(0);
  const bumpTimeline = () => setTimelineVersion((v) => v + 1);
  // 事后修正面板（针对历史回合）
  const [editingPastTurn, setEditingPastTurn] = useState<{ turn: number; mode: "thisOnly" | "cascade" } | null>(null);

  const handleEnemySkillSelect = (move: Move) => {
    if (enemyOverrideSlot === null) return;
    setEnemyMoves(prev => { const n = [...prev]; n[enemyOverrideSlot] = move; return n; });
    setEnemyOverrideSlot(null);
  };
  const baseMyMoves = useMemo(() => myDamage.map(a => a.move), [myDamage]);
  const baseEnemyMoves = useMemo(() => enemyDamage.map(a => a.move), [enemyDamage]);

  useEffect(() => {
    // Resolve full detail monsters (with traits) for battle simulation
    const resolvedMyTeam = myTeam.map(m => ({
      ...m,
      monster: { ...(detailMap.get(m.monster.id) || m.monster), default_legacy_type: (m as any).bloodline || (detailMap.get(m.monster.id) || m.monster).default_legacy_type },
      captureBall: (m as any).captureBall ?? null,
      beastBloodline: (m as any).beastBloodline ?? null,
    }));
    const resolvedEnemy = enemyTeam.map(m => detailMap.get(m.id) || m);
    const b = initBattle(
      resolvedMyTeam,
      resolvedEnemy,
      myActiveIndex,
      teamMagicItem as MagicItemId | null
    );
    b.myTeam[myActiveIndex].moveSlots = [...baseMyMoves];
    b.enemyTeam[enemyActiveIndex].moveSlots = [...baseEnemyMoves];
    setBattle(applyInitialTraits(b));
    setMyAction(null);
    setEnemyAction(null);
    setMyMoves(baseMyMoves);
    setEnemyMoves(baseEnemyMoves);
    // 新对局：重置时间线
    resetTimeline();
    bumpTimeline();
  }, [myTeam, enemyTeam, myActiveIndex, enemyActiveIndex, baseMyMoves, baseEnemyMoves, teamMagicItem]);

  const executeTurn = useCallback(() => {
    if (!battle || !myAction || !enemyAction) return;
    if (!battle.myTeam[battle.myActive].isAlive && myAction.type !== "switch") return;
    if (!battle.enemyTeam[battle.enemyActive].isAlive && enemyAction.type !== "switch") return;
    setPrevBattle(battle);
    const next = resolveTurn(battle, myAction, enemyAction);
    setBattle(next);
    // 写入时间线（供 P4 事后修正用）
    appendTurnRecord({
      turn: battle.turn,
      stateBefore: battle,
      stateAfter: next,
      myAction,
      enemyAction,
    });
    bumpTimeline();
    setMyAction(null);
    setEnemyAction(null);
    if (next.myTeam[next.myActive].moveSlots.length > 0) setMyMoves(next.myTeam[next.myActive].moveSlots);
    if (next.enemyTeam[next.enemyActive].moveSlots.length > 0) setEnemyMoves(next.enemyTeam[next.enemyActive].moveSlots);
    // Revert random skills: restore originals so user can pick again next turn
    setMyMoves(prev => prev.map((m, i) => randomSlotOriginal[i] || m));
    setRandomSlotOriginal({});
    // 默认弹核对条（1.5s 自动确认 or 用户改）
    setCorrectionPrevBattle(battle);
    setCorrectionBarBattle(next);
  }, [battle, myAction, enemyAction, randomSlotOriginal]);

  // 核对条确认（自动或手动）
  const handleCorrectionConfirm = useCallback((c: Correction | null) => {
    if (c && correctionBarBattle) {
      const fixed: BattleState = {
        ...correctionBarBattle,
        myTeam: correctionBarBattle.myTeam.map((b, i) => i === correctionBarBattle.myActive ? {
          ...b,
          currentHp: c.myHpAbsolute !== undefined ? c.myHpAbsolute : b.currentHp,
          energy: c.myEnergy !== undefined ? c.myEnergy : b.energy,
        } : b),
        enemyTeam: correctionBarBattle.enemyTeam.map((b, i) => i === correctionBarBattle.enemyActive ? {
          ...b,
          currentHp: c.enemyHpPercent !== undefined ? Math.round(b.maxHp * c.enemyHpPercent / 100) : b.currentHp,
          energy: c.enemyEnergy !== undefined ? c.enemyEnergy : b.energy,
        } : b),
      };
      setBattle(fixed);
    }
    setCorrectionBarBattle(null);
    setCorrectionPrevBattle(null);
    onTurnExecutedRef.current?.();
  }, [correctionBarBattle]);

  const handleCorrectionCancel = useCallback(() => {
    setCorrectionBarBattle(null);
    setCorrectionPrevBattle(null);
    onTurnExecutedRef.current?.();
  }, []);

  // 事后修正：用户在时间线点开历史回合
  const handleHistoricalCorrect = useCallback((turn: number, mode: "thisOnly" | "cascade") => {
    setEditingPastTurn({ turn, mode });
  }, []);

  // 事后修正提交（针对历史回合）
  const applyHistoricalCorrection = useCallback((c: Correction) => {
    if (!editingPastTurn) return;
    const { turn, mode } = editingPastTurn;
    const records = getTimeline();
    const rec = records.find((r) => r.turn === turn);
    if (!rec) { setEditingPastTurn(null); return; }
    // 把修正应用到该回合的 stateAfter（构造修正版 BattleState）
    const fixedAfter: BattleState = {
      ...rec.stateAfter,
      myTeam: rec.stateAfter.myTeam.map((b, i) => i === rec.stateAfter.myActive ? {
        ...b,
        currentHp: c.myHpAbsolute !== undefined ? c.myHpAbsolute : b.currentHp,
        energy: c.myEnergy !== undefined ? c.myEnergy : b.energy,
      } : b),
      enemyTeam: rec.stateAfter.enemyTeam.map((b, i) => i === rec.stateAfter.enemyActive ? {
        ...b,
        currentHp: c.enemyHpPercent !== undefined ? Math.round(b.maxHp * c.enemyHpPercent / 100) : b.currentHp,
        energy: c.enemyEnergy !== undefined ? c.enemyEnergy : b.energy,
      } : b),
    };
    // 如果用户输入了实际伤害，记录观察（喂给反推引擎）
    if (c.observedDamage !== undefined && c.observedDamage > 0) {
      const myActiveIdx = rec.stateAfter.myActive;
      const enActiveIdx = rec.stateAfter.enemyActive;
      const enBattler = rec.stateAfter.enemyTeam[enActiveIdx];
      const myBattler = rec.stateAfter.myTeam[myActiveIdx];
      const enAction = rec.enemyAction;
      const enMove = enAction?.type === "move" ? enAction.move : null;
      const stab = !!(enMove?.move_type && enBattler?.monster && (
        enMove.move_type.name === enBattler.monster.main_type?.name ||
        enMove.move_type.name === enBattler.monster.sub_type?.name
      ));
      const defTypes = myBattler?.monster
        ? [myBattler.monster.main_type, myBattler.monster.sub_type].filter(Boolean) as any[]
        : [];
      const eff = enMove?.move_type && defTypes.length > 0
        ? getTypeEffectiveness(enMove.move_type.name, defTypes) : 1;
      const cat = enMove?.move_category;
      const defStat = cat === "Physical Attack" ? myBattler?.baseStats?.phyDef
        : cat === "Magic Attack" ? myBattler?.baseStats?.magDef : undefined;
      recordObservation({
        turn,
        attackerSide: "enemy",
        attackerName: enBattler?.monster?.localized?.zh?.name || "?",
        defenderName: myBattler?.monster?.localized?.zh?.name || "?",
        moveName: enMove?.localized?.zh?.name,
        movePower: enMove?.power || undefined,
        moveCategory: cat,
        stab,
        typeEffectiveness: eff,
        defenderDef: defStat,
        observedDamage: c.observedDamage,
        defMaxHp: myBattler?.maxHp,
      });
    }
    const desc: string[] = [];
    if (c.enemyHpPercent !== undefined) desc.push(`敌方实际HP ${c.enemyHpPercent}%`);
    if (c.myHpAbsolute !== undefined) desc.push(`我方实际HP ${c.myHpAbsolute}`);
    if (c.observedDamage !== undefined) desc.push(`实际伤害 ${c.observedDamage}`);
    const description = desc.join("、") || "已修正";

    if (mode === "thisOnly") {
      overrideTurnAfter(turn, fixedAfter);
      injectCorrectionMessage(turn, `R${turn} 数据已修正：${description}（仅当条修改，不影响后续推演）`);
    } else {
      // 级联重算：把 R{turn} 的 stateBefore 当起点重跑后续 actions
      // 注意：修正发生在"该回合执行后"，所以重算前要把修正注入下一回合的 stateBefore
      // 简化策略：把修正后的 stateAfter 作为下一回合的 stateBefore 起点，跳过该回合本身
      const nextTurnIdx = records.findIndex((r) => r.turn === turn) + 1;
      if (nextTurnIdx < records.length) {
        replayFromTurn(records[nextTurnIdx].turn, fixedAfter);
      } else {
        overrideTurnAfter(turn, fixedAfter);
      }
      // 把修正后的最新 state 应用到当前 battle
      const newRecords = getTimeline();
      const last = newRecords[newRecords.length - 1];
      if (last) setBattle(last.stateAfter);
      injectCorrectionMessage(turn, `R${turn} 数据已修正：${description}（已重算 R${turn} 至当前的所有回合）`);
    }
    bumpTimeline();
    setEditingPastTurn(null);
  }, [editingPastTurn]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (leaderSearchSide !== null || willpowerPending !== null) return;
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        executeTurn();
      }
      if (e.key === "Escape") {
        setMyAction(null);
        setEnemyAction(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [executeTurn, leaderSearchSide, willpowerPending]);

  const undoLastTurn = () => {
    if (!prevBattle) return;
    setBattle(prevBattle);
    setMyMoves(prevBattle.myTeam[prevBattle.myActive].moveSlots);
    setEnemyMoves(prevBattle.enemyTeam[prevBattle.enemyActive].moveSlots);
    setMyAction(null);
    setEnemyAction(null);
    setPrevBattle(null);
    // 同步撤销 AI 对话：裁掉 turn >= prevBattle.turn 的所有 entry
    onUndoTurn?.(prevBattle.turn);
  };

  const resetBattle = () => {
    setPrevBattle(null);
    const resolvedMyTeam = myTeam.map(m => ({
      ...m,
      monster: { ...(detailMap.get(m.monster.id) || m.monster), default_legacy_type: (m as any).bloodline || (detailMap.get(m.monster.id) || m.monster).default_legacy_type },
      captureBall: (m as any).captureBall ?? null,
      beastBloodline: (m as any).beastBloodline ?? null,
    }));
    const resolvedEnemy = enemyTeam.map(m => detailMap.get(m.id) || m);
    const b = initBattle(
      resolvedMyTeam,
      resolvedEnemy,
      myActiveIndex,
      teamMagicItem as MagicItemId | null
    );
    b.myTeam[myActiveIndex].moveSlots = [...baseMyMoves];
    b.enemyTeam[enemyActiveIndex].moveSlots = [...baseEnemyMoves];
    setBattle(applyInitialTraits(b));
    setMyAction(null);
    setEnemyAction(null);
  };

  const myBattler = battle ? battle.myTeam[battle.myActive] : undefined;
  const enemyBattler = battle ? battle.enemyTeam[battle.enemyActive] : undefined;

  // 敌方攻击区间推测（来自反推引擎；每回合刷新）
  const enemyAtkEstimate = useMemo(() => {
    if (!enemyBattler) return "";
    const name = enemyBattler.monster?.localized?.zh?.name;
    if (!name) return "";
    const est = estimateAttackerStats(name);
    if (est.confidence === 0) return "";
    const parts: string[] = [];
    if (est.phyAtk) {
      const mid = Math.round((est.phyAtk.min + est.phyAtk.max) / 2);
      const pers = estimatePersonalityName(enemyBattler.monster, mid, "Physical Attack");
      const persLabel = pers ? `·${pers.zh}${pers.confidence === "low" ? "?" : ""}` : "";
      parts.push(`物攻≈${mid}${persLabel}`);
    }
    if (est.magAtk) {
      const mid = Math.round((est.magAtk.min + est.magAtk.max) / 2);
      const pers = estimatePersonalityName(enemyBattler.monster, mid, "Magic Attack");
      const persLabel = pers ? `·${pers.zh}${pers.confidence === "low" ? "?" : ""}` : "";
      parts.push(`魔攻≈${mid}${persLabel}`);
    }
    if (parts.length === 0) return "";
    return `${parts.join(" / ")}（${est.confidence}次）`;
  }, [battle?.turn, enemyBattler?.monster?.id]);
  const lastLog = battle?.log[battle.log.length - 1];

  const isAdvantage = matchup.pressure === "a→b";
  const isDisadvantage = matchup.pressure === "b→a";
  const isMutual = matchup.pressure === "mutual";

  const cardBg = isAdvantage ? "bg-green-50/40"
    : isDisadvantage ? "bg-red-50/40"
    : "bg-amber-50/60";
  const headerBg = isAdvantage ? "bg-green-100/60"
    : isDisadvantage ? "bg-red-100/60"
    : "bg-amber-100/60";
  const borderColor = isAdvantage ? "border-green-200"
    : isDisadvantage ? "border-red-200"
    : "border-amber-200";

  const pressureLabel = isAdvantage ? "优势"
    : isDisadvantage ? "劣势"
    : isMutual ? "互相威胁"
    : "僵持";
  const pressureBadge = isAdvantage ? "bg-green-500 text-white"
    : isDisadvantage ? "bg-red-500 text-white"
    : isMutual ? "bg-amber-500 text-white"
    : "bg-zinc-400 text-white";

  const spdLabel = atkSpd > defSpd ? "先手"
    : atkSpd < defSpd ? "后手" : "同速";
  const spdBadge = atkSpd > defSpd ? "bg-green-100 text-green-700"
    : atkSpd < defSpd ? "bg-red-100 text-red-700"
    : "bg-amber-100 text-amber-700";

  const handleLeaderSelect = (monster: Monster) => {
    if (!battle || !leaderSearchSide) return;
    const next = applyMagicItem(battle, leaderSearchSide, monster);
    setBattle(next);
    setLeaderSearchSide(null);
    const detail = detailMap.get(monster.id);
    const pool = (detail?.move_pool || []) as Move[];
    if (leaderSearchSide === "my") {
      setMyMoves(pool.slice(0, 4));
      setMyAction(null);
    } else {
      setEnemyMoves(pool.slice(0, 4));
      setEnemyAction(null);
    }
  };

  const handleWillpower = (side: "my" | "enemy", currentBattle?: BattleState) => {
    const b = currentBattle || battle;
    if (!b) return;
    const battler = side === "my" ? b.myTeam[b.myActive] : b.enemyTeam[b.enemyActive];
    const bloodline = battler.monster.default_legacy_type?.name || battler.monster.main_type.name;
    const wpMove = createWillpowerMove(bloodline);
    if (!wpMove) return;

    const next = applyMagicItem(b, side);
    setBattle(next);

    if (side === "my") {
      setMyMoves((prev) => [wpMove, ...prev.slice(1)]);
      setMyAction(null);
    } else {
      setEnemyMoves((prev) => [wpMove, ...prev.slice(1)]);
      setEnemyAction(null);
    }
  };

  const handleUseMagicItem = (side: "my" | "enemy", selectItemId?: string) => {
    if (!battle) return;
    const isMy = side === "my";

    if (selectItemId === "evolution_power") {
      // Toggle leader search
      if (leaderSearchSide === side) {
        setLeaderSearchSide(null);
        return;
      }
      const evoUses = isMy ? battle.myMagicItemUses : battle.enemyMagicItemUses;
      if ((isMy ? battle.myMagicItem : battle.enemyMagicItem) === "evolution_power" && evoUses >= 1) return;

      // If monster has leader_form_id, auto-match without search
      const battler = isMy ? battle.myTeam[battle.myActive] : battle.enemyTeam[battle.enemyActive];
      const monsterDetail = detailMap.get(battler.monster.id);
      const leaderId = battler.monster.leader_form_id ?? monsterDetail?.leader_form_id;
      if (leaderId) {
        const leaderMonster = detailMap.get(leaderId);
        if (leaderMonster) {
          const next = isMy
            ? { ...battle, myMagicItem: "evolution_power" as MagicItemId }
            : { ...battle, enemyMagicItem: "evolution_power" as MagicItemId };
          const applied = applyMagicItem(next, side, leaderMonster);
          setBattle(applied);
          if (side === "my") {
            setMyMoves(applied.myTeam[applied.myActive].moveSlots);
            setMyAction(null);
          } else {
            setEnemyMoves(applied.enemyTeam[applied.enemyActive].moveSlots);
            setEnemyAction(null);
          }
          return;
        }
      }

      // Fallback: open manual search
      const next = isMy
        ? { ...battle, myMagicItem: "evolution_power" as MagicItemId }
        : { ...battle, enemyMagicItem: "evolution_power" as MagicItemId };
      setBattle(next);
      setLeaderSearchSide(side);
      return;
    }

    if (selectItemId === "willpower_enhancement") {
      const willpowerActive = isMy ? battle.myWillpowerActive : battle.enemyWillpowerActive;
      // Deactivate (always allowed)
      if (willpowerActive) {
        const next = isMy ? { ...battle, myWillpowerActive: false } : { ...battle, enemyWillpowerActive: false };
        setBattle(next);
        if (side === "my") {
          setMyMoves((prev) => {
            const b = battle.myTeam[battle.myActive];
            const d = detailMap.get(b.monster.id);
            const pool = (d?.move_pool || []) as Move[];
            return [pool[0] || prev[0], ...prev.slice(1)];
          });
          setMyAction(null);
        } else {
          setEnemyMoves((prev) => {
            const b = battle.enemyTeam[battle.enemyActive];
            const d = detailMap.get(b.monster.id);
            const pool = (d?.move_pool || []) as Move[];
            return [pool[0] || prev[0], ...prev.slice(1)];
          });
          setEnemyAction(null);
        }
        setWillpowerPending(null);
        return;
      }
      // Not active → enter pending state for confirmation
      const wpUses = isMy ? battle.myMagicItemUses : battle.enemyMagicItemUses;
      const wpCD = isMy ? battle.myMagicItemCooldown : battle.enemyMagicItemCooldown;
      if (wpUses >= 2 || wpCD > 0) return;
      setWillpowerPending(willpowerPending === side ? null : side);
      return;
    }

    // Confirm willpower activation
    if (selectItemId === "willpower_confirm") {
      if (willpowerPending !== side) return;
      const isPendMy = side === "my";
      const next = isPendMy
        ? { ...battle, myMagicItem: "willpower_enhancement" as MagicItemId, myWillpowerActive: true }
        : { ...battle, enemyMagicItem: "willpower_enhancement" as MagicItemId, enemyWillpowerActive: true };
      setBattle(next);
      handleWillpower(side, next);
      const battler = isPendMy ? battle.myTeam[battle.myActive] : battle.enemyTeam[battle.enemyActive];
      const bloodline = battler.monster.default_legacy_type?.name || battler.monster.main_type.name;
      const wpMove = createWillpowerMove(bloodline);
      if (wpMove) {
        if (side === "my") setMyAction({ type: "move", move: wpMove });
        else setEnemyAction({ type: "move", move: wpMove });
      }
      setWillpowerPending(null);
      return;
    }
  };

  // Skill override for random/borrow skills (我方 only)
  const handleOpenSkillOverride = (slotIndex: number, move: Move) => {
    const desc = move.localized?.zh?.description || move.description || "";
    // Extract type for 巧变 skills
    const qiaoMatch = desc.match(/巧变[：:]\s*(\S+)系?/);
    setSkillOverrideType(qiaoMatch ? qiaoMatch[1] : "");
    setSkillOverrideSlot(slotIndex);
  };

  const handleSkillOverrideSelect = (move: Move) => {
    if (skillOverrideSlot === null) return;
    setMyMoves(prev => {
      const next = [...prev];
      // Save the original random skill to revert later
      const original = next[skillOverrideSlot];
      if (!randomSlotOriginal[skillOverrideSlot]) {
        setRandomSlotOriginal(prev2 => ({ ...prev2, [skillOverrideSlot]: original }));
      }
      // Replace with the selected skill but keep name as "借用→X"
      next[skillOverrideSlot] = {
        ...move,
        localized: {
          ...move.localized,
          zh: {
            ...move.localized.zh,
            name: `${original.localized.zh.name}→${move.localized.zh.name}`,
          },
        },
      };
      return next;
    });
    setSkillOverrideSlot(null);
  };


  // ── HP/Energy quick adjust ──
  const adjustHp = (side: "my" | "enemy", delta: number) => {
    if (!battle) return;
    const next = { ...battle };
    const teamKey = side === "my" ? "myTeam" : "enemyTeam";
    const idx = side === "my" ? battle.myActive : battle.enemyActive;
    next[teamKey] = [...battle[teamKey]];
    next[teamKey][idx] = { ...battle[teamKey][idx], currentHp: Math.max(0, Math.min(battle[teamKey][idx].maxHp, battle[teamKey][idx].currentHp + delta)) };
    setBattle(next);
  };
  const setHpPct = (side: "my" | "enemy", pct: number) => {
    if (!battle) return;
    const next = { ...battle };
    const teamKey = side === "my" ? "myTeam" : "enemyTeam";
    const idx = side === "my" ? battle.myActive : battle.enemyActive;
    next[teamKey] = [...battle[teamKey]];
    next[teamKey][idx] = { ...battle[teamKey][idx], currentHp: Math.round(battle[teamKey][idx].maxHp * pct / 100) };
    setBattle(next);
  };
  const adjustEnergy = (side: "my" | "enemy", delta: number) => {
    if (!battle) return;
    const next = { ...battle };
    const teamKey = side === "my" ? "myTeam" : "enemyTeam";
    const idx = side === "my" ? battle.myActive : battle.enemyActive;
    next[teamKey] = [...battle[teamKey]];
    next[teamKey][idx] = { ...battle[teamKey][idx], energy: Math.max(0, Math.min(10, battle[teamKey][idx].energy + delta)) };
    setBattle(next);
  };
  const setEnergy = (side: "my" | "enemy", value: number) => {
    if (!battle) return;
    const next = { ...battle };
    const teamKey = side === "my" ? "myTeam" : "enemyTeam";
    const idx = side === "my" ? battle.myActive : battle.enemyActive;
    next[teamKey] = [...battle[teamKey]];
    next[teamKey][idx] = { ...battle[teamKey][idx], energy: Math.max(0, Math.min(10, value)) };
    setBattle(next);
  };

  // Death switch: immediately switch to alive teammate when active battler is dead
  const handleDeathSwitch = (side: "my" | "enemy", toIndex: number) => {
    if (!battle) return;
    const activeKey = side === "my" ? "myActive" : "enemyActive";
    const teamKey = side === "my" ? "myTeam" : "enemyTeam";
    const battler = battle[teamKey][battle[activeKey]];
    if (battler.isAlive) return;
    const target = battle[teamKey][toIndex];
    if (!target || !target.isAlive) return;

    const next = { ...battle };
    next[teamKey] = [...battle[teamKey]];
    next[teamKey][next[activeKey]] = { ...battler, statStages: { phyAtk: 0, magAtk: 0, phyDef: 0, magDef: 0, spd: 0 }, pctBuffs: { phyAtk: 0, magAtk: 0, phyDef: 0, magDef: 0, spd: 0 }, chargedMove: null };
    next[activeKey] = toIndex;
    next[teamKey][toIndex].turnsOnField = 0;
    setBattle(next);

    const detail = detailMap.get(target.monster.id);
    const pool = (detail?.move_pool || []) as Move[];
    let newMoves = pool.slice(0, 4);
    // Preserve willpower toggle state
    const isDeadSwitchMy = side === "my";
    const wpActive = isDeadSwitchMy ? next.myWillpowerActive : next.enemyWillpowerActive;
    if (wpActive) {
      const bloodline = target.monster.default_legacy_type?.name || target.monster.main_type.name;
      const wpMove = createWillpowerMove(bloodline);
      if (wpMove) newMoves = [wpMove, ...newMoves.slice(1)];
    }
    if (side === "my") {
      setMyMoves(newMoves);
      setMyAction(null);
    } else {
      setEnemyMoves(newMoves);
      setEnemyAction(null);
    }
  };

  return (
    <div className={`rounded-xl border shadow-sm ${cardBg} ${borderColor} overflow-hidden h-full flex flex-col relative`}>
      {/* Header */}
      <div className={`px-3 py-1.5 flex items-center justify-between shrink-0 ${headerBg}`}>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-800">对局分析</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${spdBadge}`}>
            {spdLabel} {atkSpd}:{defSpd}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${pressureBadge}`}>
            {pressureLabel}
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* ─── 我方 ─── */}
        {myBattler && (
          <div className="border-b border-zinc-200/50">
            <BattlerPanel
              battler={myBattler}
              moves={myMoves}
              selected={myAction}
              onSelect={setMyAction}
              marks={battle!.marks.filter(m => m.side === "my")}
              weather={battle!.weather}
              sideLabel="我方"
              onUseMagic={(itemId) => handleUseMagicItem("my", itemId)}
              onDeathSwitch={(toIndex) => handleDeathSwitch("my", toIndex)}
              leaderSearchSide={leaderSearchSide}
              willpowerPending={willpowerPending}
              battle={battle}
              onOverrideSkill={handleOpenSkillOverride}
              enemySkillTypes={enemySkillTypes}
              setEnemySkillTypes={setEnemySkillTypes}
              personalityLabel={(() => { const tm = myTeam[myActiveIndex]; return tm?.personality ? formatPersonality(tm.personality) : ""; })()}
              talentLabel={(() => { const tm = myTeam[myActiveIndex]; const t = tm?.talent; return t ? Object.entries(t).filter(([,v]) => v>0).map(([k]) => ({hp_boost:"生命",phy_atk_boost:"物攻",mag_atk_boost:"魔攻",phy_def_boost:"物防",mag_def_boost:"魔防",spd_boost:"速度"}[k]||"")).join(" ") : ""; })()}
              onAdjustHp={(d) => adjustHp("my", d)}
              onSetHp={(p) => setHpPct("my", p)}
              onAdjustEnergy={(d) => adjustEnergy("my", d)}
              onSetEnergy={(v) => setEnergy("my", v)}
            />
          </div>
        )}

        {/* ─── 敌方 ─── */}
        {enemyBattler && (
          <div className="border-b border-zinc-200/50">
            <BattlerPanel
              battler={enemyBattler}
              moves={enemyMoves}
              selected={enemyAction}
              onSelect={setEnemyAction}
              marks={battle!.marks.filter(m => m.side === "enemy")}
              weather={battle!.weather}
              sideLabel="敌方"
              onUseMagic={(itemId) => handleUseMagicItem("enemy", itemId)}
              onDeathSwitch={(toIndex) => handleDeathSwitch("enemy", toIndex)}
              leaderSearchSide={leaderSearchSide}
              willpowerPending={willpowerPending}
              battle={battle}
              onOverrideSkill={handleOpenSkillOverride}
              enemySkillTypes={enemySkillTypes}
              setEnemySkillTypes={setEnemySkillTypes}
              personalityLabel={(() => { const e = enemyTeam[enemyActiveIndex]; const p = getPopularPersonality(e?.id || 0); return p ? formatPersonality(p) : ""; })()}
              talentLabel={(() => { const e = enemyTeam[enemyActiveIndex]; const t = getPopularTalent(e?.id || 0); return t ? Object.entries(t).filter(([,v]) => v>0).map(([k]) => ({hp_boost:"生命",phy_atk_boost:"物攻",mag_atk_boost:"魔攻",phy_def_boost:"物防",mag_def_boost:"魔防",spd_boost:"速度"}[k]||"")).join(" ") : ""; })()}
              attackEstimateLabel={enemyAtkEstimate}
              onAdjustHp={(d) => adjustHp("enemy", d)}
              onSetHp={(p) => setHpPct("enemy", p)}
              onAdjustEnergy={(d) => adjustEnergy("enemy", d)}
              onSetEnergy={(v) => setEnergy("enemy", v)}
            />
          </div>
        )}

        {/* Enemy skill override dialog */}
        {enemyOverrideSlot !== null && battle && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/20 rounded-xl" onClick={() => setEnemyOverrideSlot(null)}>
            <div className="bg-white rounded-xl border border-zinc-300 shadow-xl p-4 w-80 max-h-80 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-red-700">✎ 更换敌方技能</span>
                <button onClick={() => setEnemyOverrideSlot(null)} className="text-zinc-400 hover:text-zinc-600">×</button>
              </div>
              <MoveSearch
                movePool={(() => {
                  const enemyB = battle.enemyTeam[battle.enemyActive];
                  const detail = detailMap.get(enemyB.monster.id);
                  return (detail?.move_pool || []) as Move[];
                })()}
                onSelect={(move: Move) => handleEnemySkillSelect(move)}
              />
            </div>
          </div>
        )}

        {/* Execute + Log */}
        <div className="px-4 py-2 space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={executeTurn}
              disabled={!myAction || !enemyAction || (!myBattler?.isAlive && myAction?.type !== "switch") || (!enemyBattler?.isAlive && enemyAction?.type !== "switch")}
              className="text-sm px-4 py-1.5 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-50"
            >
              执行回合
            </button>
            {prevBattle && (
              <button onClick={undoLastTurn} className="text-xs text-amber-600 hover:text-amber-800">↩ 撤销</button>
            )}
            <button onClick={resetBattle} className="text-xs text-zinc-400 hover:text-zinc-600">重置</button>
            {battle && battle.log.length > 0 && (
              <button
                onClick={() => {
                  const lines: string[] = [];
                  lines.push(`洛克沙盘 对战记录`);
                  lines.push(`时间: ${new Date().toLocaleString()}`);
                  lines.push(`---`);
                  for (const log of battle.log) {
                    lines.push(`回合 ${log.turn}:`);
                    for (const e of log.events) {
                      lines.push(`  ${e.description}`);
                    }
                    lines.push('');
                  }
                  const text = lines.join('\n');
                  navigator.clipboard.writeText(text).then(() => alert('已复制到剪贴板'));
                }}
                className="text-xs px-2 py-0.5 rounded border border-zinc-200 text-zinc-400 hover:text-zinc-600"
                title="导出对战记录"
              >导出</button>
            )}
            {battle && battle.turn > 0 && (
              <span className="text-xs text-zinc-400 ml-auto">回合 {battle.turn}</span>
            )}
            <span className="text-xs text-zinc-300 ml-2" title="空格=执行  Esc=取消">空格执行 · Esc取消</span>
          </div>

          {lastLog && (
            <div className="border-t border-zinc-100 pt-2">
              <p className="text-xs font-medium text-zinc-500 mb-1">回合 {lastLog.turn} 日志</p>
              {lastLog.events.map((e, i) => {
                // Parse damage from event description
                const dmgMatch = e.description.match(/造成\s*(\d+)\s*伤害/);
                const dmg = dmgMatch ? parseInt(dmgMatch[1]) : 0;
                const targetSide: "my" | "enemy" = e.side === "my" ? "enemy" : "my";
                return (
                <p key={i} className={`text-xs flex items-center gap-1 ${e.side === "my" ? "text-blue-600" : "text-red-600"}`}>
                  <span className="flex-1">{e.description}</span>
                  {dmg > 0 && (
                    <button
                      onClick={() => {
                        if (!battle) return;
                        const next = { ...battle };
                        const teamKey = targetSide === "my" ? "myTeam" : "enemyTeam";
                        const idx = targetSide === "my" ? battle.myActive : battle.enemyActive;
                        next[teamKey] = [...battle[teamKey]];
                        next[teamKey][idx] = { ...battle[teamKey][idx], currentHp: Math.max(0, battle[teamKey][idx].currentHp - dmg) };
                        setBattle(next);
                      }}
                      className="text-[10px] px-1 rounded bg-zinc-100 text-zinc-500 hover:bg-red-50 hover:text-red-500 shrink-0"
                      title={`应用 ${dmg} 伤害到${targetSide === "my" ? "我方" : "敌方"}`}
                    >-{dmg}</button>
                  )}
                </p>
              )})}
              {battle && battle.log.length > 0 && (
                <details className="text-xs text-zinc-400 mt-1" open={battle.log.length <= 3}>
                  <summary className="cursor-pointer hover:text-zinc-600 font-medium">对战记录 ({battle.log.length} 回合) ▼</summary>
                  <div className="mt-1 space-y-1.5 max-h-40 overflow-y-auto">
                    {battle.log.slice().reverse().map((log) => (
                      <div key={log.turn} className={`border-l-2 pl-2 ${log.turn === battle.log[battle.log.length-1].turn ? "border-indigo-300" : "border-zinc-200"}`}>
                        <p className="font-medium text-zinc-500 mb-0.5">回合 {log.turn}</p>
                        {log.events.map((e, i) => (
                          <p key={i} className={e.side === "my" ? "text-blue-500" : "text-red-500"}>{e.description}</p>
                        ))}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Leader search popup */}
      {leaderSearchSide !== null && battle && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/20 rounded-xl" onClick={() => setLeaderSearchSide(null)}>
          <div className="bg-white rounded-xl border border-zinc-300 shadow-xl p-4 w-80 max-h-72 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-zinc-700">选择首领形态</span>
              <button onClick={() => setLeaderSearchSide(null)} className="text-zinc-400 hover:text-zinc-600">×</button>
            </div>
            <MonsterSearch
              label=""
              onSelect={(monster) => handleLeaderSelect(monster)}
              defaultTypeFilter={(() => {
                const battler = leaderSearchSide === "my" ? battle.myTeam[battle.myActive] : battle.enemyTeam[battle.enemyActive];
                return battler.monster.main_type.name;
              })()}
              nearbyDexNumber={(() => {
                const battler = leaderSearchSide === "my" ? battle.myTeam[battle.myActive] : battle.enemyTeam[battle.enemyActive];
                return battler.monster.dex_number;
              })()}
            />
          </div>
        </div>
      )}

      {/* Skill override popup (for 借用/取念/复写/巧变) */}
      {skillOverrideSlot !== null && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/20 rounded-xl" onClick={() => setSkillOverrideSlot(null)}>
          <div className="bg-white rounded-xl border border-zinc-300 shadow-xl p-4 w-80 max-h-80 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-purple-700">⊕ 本回合随机到的技能</span>
              <button onClick={() => setSkillOverrideSlot(null)} className="text-zinc-400 hover:text-zinc-600">×</button>
            </div>
            <p className="text-xs text-zinc-400 mb-2">选择随机技能在本回合变成的技能。回合结束后自动恢复。</p>
            <MoveSearch
              movePool={allMoves as Move[]}
              onSelect={(move: Move) => handleSkillOverrideSelect(move)}
              defaultTypeFilter={skillOverrideType}
            />
          </div>
        </div>
      )}

      {/* 核对条：执行回合后弹出，1.5s 自动确认 */}
      {correctionBarBattle && (
        <TurnCorrectionBar
          battle={correctionBarBattle}
          prevBattle={correctionPrevBattle}
          onConfirm={handleCorrectionConfirm}
          onCancel={handleCorrectionCancel}
        />
      )}

      {/* 时间线（在对局分析卡顶部之外的容器） */}
      {(() => {
        const records = getTimeline();
        void timelineVersion; // 触发重渲染
        if (records.length === 0) return null;
        return (
          <div className="mt-2">
            <TurnTimeline records={records} currentTurn={battle?.turn || 1} onCorrectTurn={handleHistoricalCorrect} />
          </div>
        );
      })()}

      {/* 历史回合修正面板 */}
      {editingPastTurn && (() => {
        const records = getTimeline();
        const rec = records.find((r) => r.turn === editingPastTurn.turn);
        if (!rec) return null;
        return (
          <HistoricalCorrectionPanel
            record={rec}
            mode={editingPastTurn.mode}
            onApply={applyHistoricalCorrection}
            onCancel={() => setEditingPastTurn(null)}
          />
        );
      })()}

    </div>
  );
}

function BagItem({ label, active, used, disabled, cooldown, remaining, onClick }: {
  label: string; active: boolean; used: boolean; disabled: boolean;
  cooldown?: number; remaining?: number; onClick: () => void;
}) {
  if (used) return <div className="w-full text-left text-xs px-1.5 py-1 rounded flex items-center gap-1 bg-purple-50 text-purple-400">{label} ✓</div>;
  return (
    <button onClick={onClick} disabled={disabled}
      className={`w-full text-left text-xs px-1.5 py-1 rounded flex items-center gap-1 ${
        disabled ? "opacity-40" : active ? "ring-2 ring-indigo-400 bg-indigo-50" : "hover:bg-zinc-50"
      }`}>
      {label}
      {cooldown ? <span className="text-zinc-400 ml-1">CD{cooldown}</span> : null}
      {remaining !== undefined ? <span className="text-zinc-400 ml-auto">({remaining})</span> : null}
    </button>
  );
}

function BattlerPanel({ battler, moves, selected, onSelect, marks, weather, sideLabel, onUseMagic, battle, onDeathSwitch, leaderSearchSide, willpowerPending, onOverrideSkill, enemySkillTypes = {}, setEnemySkillTypes = () => {}, personalityLabel = "", talentLabel = "", attackEstimateLabel = "", onAdjustHp, onSetHp, onAdjustEnergy, onSetEnergy }: {
  battler: BattlerState;
  moves: Move[];
  selected: Action | null;
  onSelect: (a: Action | null) => void;
  marks: import("../lib/simulator").Mark[];
  weather: import("../lib/simulator").Weather;
  sideLabel: string;
  onUseMagic: (itemId?: string) => void;
  battle: BattleState | null;
  onDeathSwitch: (toIndex: number) => void;
  leaderSearchSide: "my" | "enemy" | null;
  willpowerPending: "my" | "enemy" | null;
  onOverrideSkill?: (slotIndex: number, move: Move) => void;
  enemySkillTypes?: Record<number, string>;
  setEnemySkillTypes?: (v: Record<number, string>) => void;
  personalityLabel?: string;
  talentLabel?: string;
  attackEstimateLabel?: string;
  onAdjustHp?: (delta: number) => void;
  onSetHp?: (pct: number) => void;
  onAdjustEnergy?: (delta: number) => void;
  onSetEnergy?: (value: number) => void;
}) {
  const [skillFilter, setSkillFilter] = useState("");
  const [expandedEnemySlot, setExpandedEnemySlot] = useState<number | null>(null);
  const [enemySkillSearch, setEnemySkillSearch] = useState("");
  const isMy = sideLabel === "我方";
  const teamMagicItem = isMy ? battle?.myMagicItem : battle?.enemyMagicItem;
  const magicUses = isMy ? (battle?.myMagicItemUses ?? 0) : (battle?.enemyMagicItemUses ?? 0);
  const magicCD = isMy ? (battle?.myMagicItemCooldown ?? 0) : (battle?.enemyMagicItemCooldown ?? 0);
  const willpowerActive = isMy ? (battle?.myWillpowerActive ?? false) : (battle?.enemyWillpowerActive ?? false);
  const hpPct = Math.round((battler.currentHp / battler.maxHp) * 100);
  const hpColor = hpPct > 50 ? "bg-green-500" : hpPct > 25 ? "bg-yellow-500" : "bg-red-500";

  // Defender types for type effectiveness arrows
  const defTypes = ((): TypeInfo[] => {
    if (!battle) return [];
    const oppKey = sideLabel === "我方" ? "enemyTeam" : "myTeam";
    const oppIdx = sideLabel === "我方" ? battle.enemyActive : battle.myActive;
    const opp = battle[oppKey][oppIdx];
    if (!opp) return [];
    const types: TypeInfo[] = [allTypes.find(t => t.name === opp.monster.main_type.name)!].filter(Boolean);
    if (opp.monster.sub_type) { const st = allTypes.find(t => t.name === opp.monster.sub_type!.name); if (st) types.push(st); }
    return types;
  })();

  const isSelected = (a: Action) => {
    if (!selected) return false;
    if (a.type !== selected.type) return false;
    if (a.type === "move" && selected.type === "move") return a.move.id === selected.move.id;
    if (a.type === "switch" && selected.type === "switch") return a.toIndex === selected.toIndex;
    return a.type === selected.type;
  };

  // Toggle select: click again to deselect
  const toggleSelect = (a: Action) => {
    if (isSelected(a)) {
      onSelect(null);
    } else {
      onSelect(a);
    }
  };

  return (
    <div className="px-4 py-2.5 space-y-2">
      {/* Name + HP + Energy row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-zinc-800 w-16 shrink-0">{sideLabel}</span>
        <span className="text-sm font-medium text-zinc-700">{battler.monster.localized.zh.name}</span>
        {personalityLabel && <span className="text-[10px] text-zinc-400">{personalityLabel}</span>}
        {talentLabel && <span className="text-[10px] text-zinc-400">个体：{talentLabel}</span>}
        {attackEstimateLabel && (
          <span title="基于实际伤害反推" className="text-[10px] text-purple-500 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded">
            {attackEstimateLabel}
          </span>
        )}
        {!battler.isAlive && <span className="text-xs text-red-500 font-bold">已力竭</span>}
        {/* Team magic points */}
        {battle && (() => {
          const mp = isMy ? battle.myMagicPoints : battle.enemyMagicPoints;
          return <span className="text-[10px] text-zinc-400 ml-auto" title="队伍魔力值">魔力 {mp}/4</span>;
        })()}
      </div>

      {/* HP bar + quick adjust */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-zinc-500 w-8 shrink-0">生命</span>
        <div className="flex-1 h-3 bg-zinc-100 rounded-full overflow-hidden cursor-pointer"
          onClick={() => onSetHp?.(50)}
          title="点击设为半血">
          <div className={`h-full ${hpColor} transition-all`} style={{ width: `${hpPct}%` }} />
        </div>
        <span className="text-xs text-zinc-600 w-14 text-right tabular-nums shrink-0">{battler.currentHp}/{battler.maxHp}</span>
        {onAdjustHp && <>
          <button onClick={() => onAdjustHp(-100)} className="text-[10px] px-1 rounded border border-red-200 text-red-500 hover:bg-red-50 shrink-0">-100</button>
          <button onClick={() => onAdjustHp(-50)} className="text-[10px] px-1 rounded border border-red-200 text-red-400 hover:bg-red-50 shrink-0">-50</button>
          <button onClick={() => onSetHp?.(50)} className="text-[10px] px-1 rounded border border-zinc-200 text-zinc-500 hover:bg-zinc-50 shrink-0">半血</button>
          <button onClick={() => onSetHp?.(100)} className="text-[10px] px-1 rounded border border-zinc-200 text-zinc-500 hover:bg-zinc-50 shrink-0">满血</button>
          <button onClick={() => onAdjustHp(50)} className="text-[10px] px-1 rounded border border-green-200 text-green-500 hover:bg-green-50 shrink-0">+50</button>
        </>}
      </div>

      {/* Energy bar + quick adjust */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-zinc-500 w-8 shrink-0">能量</span>
        <div className="flex gap-0.5">
          {Array.from({ length: battler.maxEnergy }).map((_, i) => (
            <button key={i} onClick={() => onSetEnergy?.(i + 1)}
              title={`设为${i + 1}能量`}
              className={`w-2.5 h-3 rounded-sm cursor-pointer ${i < battler.energy ? "bg-amber-400 hover:bg-amber-500" : "bg-zinc-200 hover:bg-zinc-300"}`} />
          ))}
        </div>
        <span className="text-xs text-zinc-600">{battler.energy}/{battler.maxEnergy}</span>
        {onAdjustEnergy && <>
          <button onClick={() => onAdjustEnergy(-1)} className="text-[10px] px-1 rounded border border-red-200 text-red-400 hover:bg-red-50 shrink-0">-1</button>
          <button onClick={() => onAdjustEnergy(3)} className="text-[10px] px-1 rounded border border-green-200 text-green-500 hover:bg-green-50 shrink-0">+3</button>
        </>}
        <button
          onClick={() => toggleSelect({ type: "focus" })}
          className={`text-xs px-2 py-0.5 rounded border ml-0.5 ${
            isSelected({ type: "focus" }) ? "ring-2 ring-indigo-400 bg-indigo-50 border-indigo-300" : "border-zinc-200 hover:bg-zinc-50 text-zinc-600"
          }`}
        >
          聚能+5
        </button>
      </div>

      {/* Status tags */}
      <div className="flex gap-0.5 flex-wrap">
        {battler.burnLayers > 0 && <span className="text-xs px-1 rounded bg-orange-100 text-orange-600">灼烧×{battler.burnLayers}</span>}
        {battler.poisonLayers > 0 && <span className="text-xs px-1 rounded bg-purple-100 text-purple-600">中毒×{battler.poisonLayers}</span>}
        {battler.freezeLayers > 0 && <span className="text-xs px-1 rounded bg-cyan-100 text-cyan-600">冰冻×{battler.freezeLayers}</span>}
        {battler.defending && <span className="text-xs px-1 rounded bg-blue-100 text-blue-600">防御</span>}
        {battler.defenseCooldown > 0 && <span className="text-xs px-1 rounded bg-zinc-100 text-zinc-400">防CD{battler.defenseCooldown}</span>}
        {battler.overloadStacks > 0 && <span className="text-xs px-1 rounded bg-pink-100 text-pink-600">过载×{battler.overloadStacks}</span>}
        {battler.stunned && <span className="text-xs px-1 rounded bg-yellow-100 text-yellow-700">眩晕</span>}
        {battler.regressionLayers > 0 && <span className="text-xs px-1 rounded bg-pink-100 text-pink-600">萌化×{battler.regressionLayers}</span>}
        {battler.lifestealPct > 0 && <span className="text-xs px-1 rounded bg-red-100 text-red-600">吸血{battler.lifestealPct}%</span>}
        {battler.comboModifier !== 0 && <span className="text-xs px-1 rounded bg-sky-100 text-sky-600">连击{battler.comboModifier>0?'+'+battler.comboModifier:battler.comboModifier}</span>}
        {battler.chargedMove && <span className="text-xs px-1 rounded bg-amber-100 text-amber-600">蓄力:{battler.chargedMove.localized.zh.name}</span>}
        {marks.map(m => (
          <span key={m.name} className={`text-xs px-1 rounded ${m.type === "positive" ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600"}`}>
            {MARK_INFO[m.name].zh}{m.layers > 1 ? `×${m.layers}` : ""}
          </span>
        ))}
        {/* Trait effect labels */}
        {getTraitEffectLabels(battler).map((trait, i) => (
          <span key={`trait-${i}`}
            className={`text-xs px-1 rounded border cursor-help ${trait.isPermanent ? "bg-lime-100 text-lime-700 border-lime-300" : "bg-amber-50 text-amber-600 border-amber-200"}`}
            title={`${trait.tooltip}${trait.isPermanent ? "\n[换人不重置 · 跨场累积]" : "\n[换人后清除 · 再次上场重新计算]"}`}
          >
            {trait.isPermanent ? "⟳" : ""}{trait.label}
          </span>
        ))}
        {Object.entries(battler.statStages).filter(([, v]) => v !== 0).map(([stat, val]) => {
          const names: Record<string, string> = { phyAtk: "物攻", magAtk: "魔攻", phyDef: "物防", magDef: "魔防", spd: "速度" };
          return <span key={stat} className={`text-xs px-1 rounded ${val > 0 ? "bg-blue-100 text-blue-600" : "bg-red-100 text-red-600"}`}>{names[stat]}{val > 0 ? `+${val}` : val}</span>;
        })}
        {Object.entries(battler.pctBuffs).filter(([, v]) => v !== 0).map(([stat, val]) => {
          const names: Record<string, string> = { phyAtk: "物攻", magAtk: "魔攻", phyDef: "物防", magDef: "魔防", spd: "速度" };
          return <span key={`pct-${stat}`} className={`text-xs px-1 rounded ${val > 0 ? "bg-indigo-100 text-indigo-600" : "bg-red-100 text-red-600"}`}>{names[stat]}{val > 0 ? `+${val}%` : `${val}%`}</span>;
        })}
        {weather && (
          <span className="text-xs px-1 rounded bg-sky-100 text-sky-600">
            {weather === "rain" ? "雨天" : weather === "blizzard" ? "暴风雪" : "沙暴"}
          </span>
        )}
      </div>

      {/* Skills | Bag | Switch — three equal columns */}
      <div className="flex gap-2 items-stretch">
        {/* Skills */}
        <div className="flex-[2] min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center gap-1">
            <p className="text-xs text-zinc-400">技能</p>
            <input
              type="text"
              value={skillFilter}
              onChange={(e) => setSkillFilter(e.target.value)}
              placeholder="拼音检索..."
              className="text-[10px] px-1.5 py-0.5 border border-zinc-200 rounded outline-none focus:border-indigo-300 w-20"
            />
          </div>
          {/* Last used move */}
          {battle && battle.log.length > 0 && (() => {
            const lastLog = battle.log[battle.log.length - 1];
            const isMy = sideLabel === "我方";
            const action = isMy ? lastLog.myAction : lastLog.enemyAction;
            if (!action || action.type !== "move") return null;
            const move = action.move;
            return (
              <div className="text-xs px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-800 flex items-center gap-1">
                <span className="font-medium shrink-0">上回</span>
                <span className={`shrink-0 px-1 rounded text-xs ${
                  move.move_category === "Physical Attack" ? "bg-red-50 text-red-600"
                  : move.move_category === "Magic Attack" ? "bg-purple-50 text-purple-600"
                  : move.move_category === "Defense" ? "bg-blue-50 text-blue-600"
                  : "bg-green-50 text-green-600"
                }`}>
                  {move.move_category === "Physical Attack" ? "物攻" : move.move_category === "Magic Attack" ? "魔攻"
                  : move.move_category === "Defense" ? "防御" : "状态"}
                </span>
                <span className="truncate">{move.localized.zh.name}</span>
              </div>
            );
          })()}
          <div className="border border-zinc-200 rounded-lg p-1.5 space-y-0.5 overflow-y-auto h-[210px]">
            {!battler.isAlive ? (
              <p className="text-xs text-zinc-400 text-center py-4">已力竭，请在右侧换人</p>
            ) : (<>
            {battler.chargedMove && (
              <button
                onClick={() => toggleSelect({ type: "release" })}
                className={`w-full text-left text-xs px-1.5 py-1 rounded flex items-center gap-1 border border-amber-300 bg-amber-50 ${
                  isSelected({ type: "release" }) ? "ring-2 ring-indigo-400" : "hover:bg-amber-100"
                }`}
              >
                <span className="text-amber-700 font-medium">释放</span>
                <span className="truncate text-amber-800">{battler.chargedMove.localized.zh.name}</span>
                <span className="text-amber-600 ml-auto">0费</span>
              </button>
            )}
            {moves.filter(m => !skillFilter || matchSkillName(m.localized.zh.name, skillFilter)).map((move) => {
              const idx = moves.indexOf(move);
              const action: Action = { type: "move", move };
              const canAfford = battler.energy >= move.energy_cost;
              const onDefCooldown = move.move_category === "Defense" && battler.defenseCooldown > 0;
              return (<>
                <button
                  key={move.id}
                  onClick={() => canAfford && !onDefCooldown && toggleSelect(action)}
                  disabled={!canAfford || onDefCooldown}
                  title={onDefCooldown ? "防御冷却中" : (move.localized.zh.description || move.description || "")}
                  className={`w-full text-left text-xs px-1.5 py-1 rounded flex items-center gap-1 ${
                    isSelected(action) ? "ring-2 ring-indigo-400 bg-indigo-50" : canAfford ? "hover:bg-zinc-50" : "opacity-40"
                  }`}
                >
                  <span className="text-zinc-300 w-3 shrink-0">{idx + 1}</span>
                  <span className={`shrink-0 px-1 rounded text-xs ${
                    move.move_category === "Physical Attack" ? "bg-red-50 text-red-600"
                    : move.move_category === "Magic Attack" ? "bg-purple-50 text-purple-600"
                    : move.move_category === "Defense" ? "bg-blue-50 text-blue-600"
                    : "bg-green-50 text-green-600"
                  }`}>
                    {move.move_category === "Physical Attack" ? "物攻" : move.move_category === "Magic Attack" ? "魔攻"
                      : move.move_category === "Defense" ? "防御" : "状态"}
                  </span>
                  {move.move_type && (
                    <span className={`shrink-0 text-xs px-1 rounded-full inline-flex items-center gap-0.5 ${typeDotBg(move.move_type.name)}`}>
                      <span className={`w-1 h-1 rounded-full ${TYPE_COLORS[move.move_type.name]?.dot || "bg-zinc-400"}`} />
                      {move.move_type.localized.zh}
                    </span>
                  )}
                  {move.move_type && defTypes.length > 0 && move.power && (() => {
                    const eff = getTypeEffectiveness(move.move_type!.name, defTypes);
                    if (eff > 2) return <span className="text-green-600 font-bold shrink-0">↑↑</span>;
                    if (eff > 1) return <span className="text-green-500 font-bold shrink-0">↑</span>;
                    if (eff < 0.5) return <span className="text-red-500 font-bold shrink-0">↓↓</span>;
                    if (eff < 1) return <span className="text-red-400 font-bold shrink-0">↓</span>;
                    return null;
                  })()}
                  <span className="truncate" title={`${move.localized.zh.description}\n${move.energy_cost}费 ${move.power ? move.power + "威" : "—"}`}>
                    {move.localized.zh.name}
                    {isChargeMove(move) ? " ⏳" : ""}
                    {getComboCount(move) > 1 ? ` ×${getComboCount(move)}` : ""}
                    {move.localized.zh.description.includes("迅捷") ? " ↟" : ""}
                    {(move.localized.zh.description.match(/传动(\d+)/) || [])[1] ? ` ↡${(move.localized.zh.description.match(/传动(\d+)/) || [])[1]}` : ""}
                  </span>
                  {/* Random skill ⊕ button (我方) */}
                  {isMy && onOverrideSkill && (move.localized.zh.name === "借用" || move.localized.zh.name === "取念" || move.localized.zh.name === "复写" || /巧变/.test(move.localized.zh.description)) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onOverrideSkill(idx, move); }}
                      className="shrink-0 text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-600 hover:bg-purple-200 font-bold border border-purple-200 ml-auto"
                      title="点击选择本回合随机到的技能"
                    >⊕</button>
                  )}
                  {/* Random skill type selector + expand (敌方) */}
                  {!isMy && (move.localized.zh.name === "借用" || move.localized.zh.name === "取念" || move.localized.zh.name === "复写") && (() => {
                    const selType = enemySkillTypes[idx] || "";
                    const isExpanded = expandedEnemySlot === idx;
                    return (
                    <span className="shrink-0 ml-auto flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                      <select
                        value={selType}
                        onChange={e => {
                          const newTypes = { ...enemySkillTypes };
                          if (e.target.value) newTypes[idx] = e.target.value;
                          else delete newTypes[idx];
                          setEnemySkillTypes(newTypes);
                          setEnemySkillSearch("");
                        }}
                        className="text-[10px] border border-zinc-200 rounded px-0.5"
                        title="推测敌方随机技能系别"
                      >
                        <option value="">?</option>
                        {allTypes.map(t => (
                          <option key={t.name} value={t.name}>{t.localized.zh}</option>
                        ))}
                      </select>
                      {selType && (
                        <button
                          onClick={() => {
                            setExpandedEnemySlot(isExpanded ? null : idx);
                            setEnemySkillSearch("");
                          }}
                          className={`text-[10px] px-1 rounded border ${isExpanded ? "bg-red-100 border-red-300 text-red-600" : "border-zinc-200 text-zinc-500 hover:border-zinc-300"}`}
                          title={isExpanded ? "收起" : `展开${allTypes.find(t => t.name === selType)?.localized.zh || selType}系技能`}
                        >
                          {isExpanded ? "▲" : "▼"}
                        </button>
                      )}
                      {!selType && (
                        <button
                          onClick={() => {
                            setExpandedEnemySlot(isExpanded ? null : idx);
                            setEnemySkillSearch("");
                          }}
                          className={`text-[10px] px-1 rounded border ${isExpanded ? "bg-red-100 border-red-300 text-red-600" : "border-zinc-200 text-zinc-500 hover:border-zinc-300"}`}
                          title={isExpanded ? "收起" : "展开全部技能（用拼音搜索）"}
                        >
                          {isExpanded ? "▲" : "▼"}
                        </button>
                      )}
                    </span>
                  )})()}
                  <span className="text-zinc-400 ml-auto shrink-0">{move.energy_cost}费</span>
                  {move.power && <span className="text-zinc-500 shrink-0">{move.power}威</span>}
                </button>
                {/* Expanded enemy skill list */}
                {!isMy && expandedEnemySlot === idx && (move.localized.zh.name === "借用" || move.localized.zh.name === "取念" || move.localized.zh.name === "复写") && (() => {
                  const selType = enemySkillTypes[idx] || "";
                  // 选了系别 → 限定该系；未选 → 全技能池（让用户能用拼音跨系搜索）
                  const typeSkills = selType
                    ? (allMoves as Move[]).filter(m => m.move_type?.name === selType && m.power)
                    : (allMoves as Move[]).filter(m => m.power);
                  const filteredSkills = enemySkillSearch
                    ? typeSkills.filter(s => s.localized.zh.name.includes(enemySkillSearch) || matchSkillName(s.localized.zh.name, enemySkillSearch))
                    : typeSkills;
                  return (
                <div className="ml-6 mr-1 mb-1 p-1.5 bg-red-50 border border-red-200 rounded-lg space-y-1">
                  <input
                    type="text"
                    value={enemySkillSearch}
                    onChange={e => setEnemySkillSearch(e.target.value)}
                    placeholder="搜索..."
                    className="w-full text-[10px] px-1.5 py-0.5 border border-zinc-200 rounded outline-none focus:border-red-300"
                    onClick={e => e.stopPropagation()}
                  />
                  <div className="max-h-32 overflow-y-auto space-y-0.5">
                    {filteredSkills.slice(0, 30).map(s => (
                      <button
                        key={s.id}
                        onClick={(e) => { e.stopPropagation(); }}
                        className="w-full text-left text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 hover:bg-red-100"
                        title={`${s.localized.zh.description}\n${s.energy_cost}费 ${s.power}威`}
                      >
                        <span className={`shrink-0 px-0.5 rounded text-[10px] ${
                          s.move_category === "Physical Attack" ? "bg-red-100 text-red-600"
                          : s.move_category === "Magic Attack" ? "bg-purple-100 text-purple-600"
                          : s.move_category === "Defense" ? "bg-blue-100 text-blue-600"
                          : "bg-green-100 text-green-600"
                        }`}>
                          {s.move_category === "Physical Attack" ? "物" : s.move_category === "Magic Attack" ? "魔" : s.move_category === "Defense" ? "防" : "状"}
                        </span>
                        <span className="truncate flex-1">{s.localized.zh.name}</span>
                        <span className="text-zinc-400">{s.energy_cost}费</span>
                        <span className="text-zinc-500">{s.power}威</span>
                      </button>
                    ))}
                    {filteredSkills.length === 0 && (
                      <p className="text-[10px] text-zinc-400 text-center py-1">无匹配</p>
                    )}
                  </div>
                </div>
              )})()}
              </>);
            })}
            </>)}
          </div>
        </div>

        {/* Bag — blood magic items */}
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <p className="text-xs text-zinc-400">魔法</p>
          <div className="border border-zinc-200 rounded-lg p-1.5 space-y-0.5 overflow-y-auto h-[210px]">
            <BagItem
              label="进化之力"
              active={leaderSearchSide === (isMy ? "my" : "enemy")}
              used={teamMagicItem === "evolution_power" && magicUses >= 1}
              disabled={!battler.isAlive}
              onClick={() => onUseMagic("evolution_power")}
            />
            <BagItem
              label="愿力强化"
              active={willpowerActive}
              used={teamMagicItem === "willpower_enhancement" && magicUses >= 2}
              disabled={!battler.isAlive || (magicCD > 0 && !willpowerActive)}
              cooldown={magicCD > 0 && !willpowerActive ? magicCD : 0}
              remaining={(teamMagicItem === "willpower_enhancement" && magicUses < 2) ? 2 - magicUses : undefined}
              onClick={() => onUseMagic("willpower_enhancement")}
            />
            {willpowerPending === (isMy ? "my" : "enemy") && (
              <div className="flex gap-1">
                <button
                  onClick={() => onUseMagic("willpower_confirm")}
                  className="flex-1 text-xs px-2 py-0.5 rounded bg-green-500 text-white hover:bg-green-600"
                >确认</button>
                <button
                  onClick={() => onUseMagic("willpower_enhancement")}
                  className="flex-1 text-xs px-2 py-0.5 rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                >取消</button>
              </div>
            )}
          </div>
        </div>

        {/* Switch — other team members */}
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <p className="text-xs text-zinc-400">换人</p>
          <div className="border border-zinc-200 rounded-lg p-1.5 space-y-1 h-[210px]">
            {battle && (() => {
              const teamKey = sideLabel === "我方" ? "myTeam" : "enemyTeam";
              const activeIdx = sideLabel === "我方" ? battle.myActive : battle.enemyActive;
              const team = battle[teamKey];
              const slots = Array.from({ length: 6 }, (_, i) => team[i] || null);
              return slots.map((b, i) => {
                if (!b) return (
                  <div key={i} className="text-xs px-1 py-0.5 rounded border border-dashed border-zinc-200 text-zinc-300 text-center">—</div>
                );
                if (i === activeIdx) return (
                  <div key={i} className="text-xs px-1 py-0.5 rounded border border-dashed border-zinc-200 text-zinc-300 truncate">在场-{b.monster.localized.zh.name}</div>
                );
                if (!b.isAlive) return (
                  <div key={i} className="text-xs px-1 py-0.5 rounded border border-zinc-100 text-zinc-300 line-through flex items-center gap-1" title={(() => { const d = detailMap.get(b.monster.id); return d?.trait ? `${b.monster.localized.zh.name} · ${d.trait.localized.zh.name}：${d.trait.localized.zh.description}` : b.monster.localized.zh.name; })()}>
                    <span className="truncate flex-1">{b.monster.localized.zh.name}</span>
                    <span className="text-right shrink-0 leading-tight text-[10px]">
                      <div>0/{b.maxHp}</div>
                      <div>—</div>
                    </span>
                  </div>
                );
                return (
                  <button
                    key={i}
                    onClick={() => toggleSelect({ type: "switch", toIndex: i })}
                    onDoubleClick={(e) => { e.preventDefault(); onDeathSwitch(i); }}
                    className={`w-full text-xs px-1 py-0.5 rounded border flex items-center gap-1 ${
                      selected?.type === "switch" && selected.toIndex === i
                        ? "ring-2 ring-indigo-400 bg-indigo-50 border-indigo-300"
                        : "border-zinc-200 hover:bg-zinc-50 text-zinc-600"
                    }`}
                    title={(() => {
                      const isDead = battle && !battle[sideLabel === "我方" ? "myTeam" : "enemyTeam"][sideLabel === "我方" ? battle.myActive : battle.enemyActive].isAlive;
                      const d = detailMap.get(b.monster.id);
                      const traitInfo = d?.trait ? `${d.trait.localized.zh.name}：${d.trait.localized.zh.description}` : "";
                      return isDead ? `双击立即换人 · ${traitInfo}` : `单击选择换人 · ${traitInfo}`;
                    })()}
                  >
                    <span className="truncate flex-1 text-left">{b.monster.localized.zh.name}</span>
                    <span className="text-right shrink-0 leading-tight text-zinc-400 text-[10px]">
                      <div>{b.currentHp}/{b.maxHp}</div>
                      <div>{b.energy}/{b.maxEnergy}</div>
                    </span>
                  </button>
                );
              });
            })()}
            {!battle && Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="text-xs px-1.5 py-0.5 rounded border border-dashed border-zinc-200 text-zinc-300 text-center">—</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function HistoricalCorrectionPanel({ record, mode, onApply, onCancel }: {
  record: import("../lib/battleTimeline").TurnRecord;
  mode: "thisOnly" | "cascade";
  onApply: (c: Correction) => void;
  onCancel: () => void;
}) {
  const after = record.stateAfter;
  const myActive = after.myTeam[after.myActive];
  const enActive = after.enemyTeam[after.enemyActive];
  const enHpPct = enActive ? Math.round(((enActive.currentHp ?? enActive.maxHp) / enActive.maxHp) * 100) : 0;

  const [enemyHp, setEnemyHp] = useState(String(enHpPct));
  const [myHp, setMyHp] = useState(String(myActive?.currentHp ?? 0));
  const [observedDmg, setObservedDmg] = useState("");

  function submit() {
    const c: Correction = {};
    const enPct = parseInt(enemyHp, 10);
    if (!isNaN(enPct) && enPct !== enHpPct) c.enemyHpPercent = enPct;
    const myAbs = parseInt(myHp, 10);
    if (!isNaN(myAbs) && myAbs !== (myActive?.currentHp ?? 0)) c.myHpAbsolute = myAbs;
    const obs = parseInt(observedDmg, 10);
    if (!isNaN(obs) && obs > 0) c.observedDamage = obs;
    onApply(c);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 px-4" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-xl border border-amber-200 p-4 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-semibold text-amber-700">事后修正 R{record.turn}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
            {mode === "thisOnly" ? "只改这条" : `重算到当前`}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3 text-xs mb-3">
          <label className="flex flex-col gap-1">
            <span className="text-zinc-500">敌方 HP</span>
            <div className="flex items-center gap-1">
              <input type="number" value={enemyHp} onChange={(e) => setEnemyHp(e.target.value)}
                className="w-full px-2 py-1 rounded border border-zinc-200 text-zinc-700 text-right" />
              <span className="text-zinc-400">%</span>
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-zinc-500">我方 HP</span>
            <input type="number" value={myHp} onChange={(e) => setMyHp(e.target.value)}
              className="w-full px-2 py-1 rounded border border-zinc-200 text-zinc-700 text-right" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-zinc-500">实际伤害</span>
            <input type="number" value={observedDmg} onChange={(e) => setObservedDmg(e.target.value)}
              placeholder="选填"
              className="w-full px-2 py-1 rounded border border-zinc-200 text-zinc-700 text-right" />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={submit}
            className="text-xs px-3 py-1.5 rounded bg-amber-500 text-white hover:bg-amber-600 font-medium">
            应用
          </button>
          <button onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded border border-zinc-200 text-zinc-500 hover:bg-zinc-50">
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

