import { useEffect, useRef, useState, useCallback } from "react";
import type { BattleState, BattlerState } from "../lib/simulator";
import { recordObservation } from "../lib/observations";
import { getTypeEffectiveness } from "../lib/calculator";

interface Props {
  battle: BattleState;
  prevBattle: BattleState | null;          // 用于对比，计算实际伤害默认值
  predictedDamage?: number;                 // 系统预测的本回合敌方对我方伤害
  onConfirm: (correction: Correction | null) => void;
  onCancel: () => void;
  autoConfirmMs?: number;                   // 默认 1500
}

export interface Correction {
  enemyHpPercent?: number;        // 用户填写的敌方 HP%
  myHpAbsolute?: number;          // 用户填写的我方 HP 数值
  myEnergy?: number;
  enemyEnergy?: number;
  observedDamage?: number;        // 用户填写的"实际伤害"
}

const KEY_EVENT_MARKERS = ["KO", "击倒", "被击败", "进化", "首领化"];

function detectKeyEvent(battle: BattleState, prevBattle: BattleState | null): string | null {
  if (!prevBattle) return null;
  const lastLog = battle.log[battle.log.length - 1];
  // 字符串关键词扫描
  if (lastLog) {
    for (const ev of lastLog.events || []) {
      const txt = ev.description || "";
      for (const m of KEY_EVENT_MARKERS) {
        if (txt.includes(m)) return txt;
      }
    }
  }
  // KO 检测：HP 从 >0 变为 <=0
  const wasMyAlive = prevBattle.myTeam[prevBattle.myActive]?.isAlive;
  const wasEnemyAlive = prevBattle.enemyTeam[prevBattle.enemyActive]?.isAlive;
  const nowMyDead = !battle.myTeam[battle.myActive]?.isAlive;
  const nowEnemyDead = !battle.enemyTeam[battle.enemyActive]?.isAlive;
  if (wasMyAlive && nowMyDead) return "我方精灵被击倒";
  if (wasEnemyAlive && nowEnemyDead) return "敌方精灵被击倒";
  // 换人检测：active 索引变化
  if (battle.myActive !== prevBattle.myActive) {
    return `我方换人：${battle.myTeam[battle.myActive]?.monster?.localized?.zh?.name || "?"} 入场`;
  }
  if (battle.enemyActive !== prevBattle.enemyActive) {
    return `敌方换人：${battle.enemyTeam[battle.enemyActive]?.monster?.localized?.zh?.name || "?"} 入场`;
  }
  // 印记新增 / 层数变化检测
  const prevMarks = new Map(prevBattle.marks.map((m) => [`${m.side || ""}|${m.name}`, m.layers || 1]));
  for (const m of battle.marks) {
    const key = `${m.side || ""}|${m.name}`;
    const prevLayers = prevMarks.get(key);
    const nowLayers = m.layers || 1;
    if (prevLayers === undefined) {
      return `新增印记：${m.name}${nowLayers > 1 ? ` ×${nowLayers}` : ""}`;
    }
    if (nowLayers > prevLayers) {
      return `印记层数增加：${m.name} ${prevLayers}→${nowLayers}`;
    }
  }
  // 冰冻层数变化（永久削 HP 上限，重要事件）
  const myFreezeBefore = prevBattle.myTeam[prevBattle.myActive]?.freezeLayers || 0;
  const myFreezeNow = battle.myTeam[battle.myActive]?.freezeLayers || 0;
  if (myFreezeNow > myFreezeBefore) return `我方冰冻 ${myFreezeBefore}→${myFreezeNow} 层`;
  const enFreezeBefore = prevBattle.enemyTeam[prevBattle.enemyActive]?.freezeLayers || 0;
  const enFreezeNow = battle.enemyTeam[battle.enemyActive]?.freezeLayers || 0;
  if (enFreezeNow > enFreezeBefore) return `敌方冰冻 ${enFreezeBefore}→${enFreezeNow} 层`;
  return null;
}

function calcDealtDamage(prev: BattlerState | undefined, now: BattlerState | undefined): number {
  if (!prev || !now) return 0;
  const d = (prev.currentHp ?? prev.maxHp) - (now.currentHp ?? now.maxHp);
  return d > 0 ? d : 0;
}

export function TurnCorrectionBar({
  battle, prevBattle, predictedDamage, onConfirm, onCancel, autoConfirmMs = 1500,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [progress, setProgress] = useState(100);
  const startTsRef = useRef<number>(Date.now());
  const rafRef = useRef<number | null>(null);

  const keyEvent = detectKeyEvent(battle, prevBattle);
  const isKey = !!keyEvent;

  const myActive = battle.myTeam[battle.myActive];
  const enActive = battle.enemyTeam[battle.enemyActive];
  const enHpPct = enActive ? Math.round(((enActive.currentHp ?? enActive.maxHp) / enActive.maxHp) * 100) : 100;

  // 本回合敌方对我方实际伤害（用作"实际伤害"输入框默认值）
  const myDamageDealt = calcDealtDamage(
    prevBattle?.myTeam[prevBattle.myActive],
    myActive,
  );

  // 修正字段（受控）
  const [enemyHp, setEnemyHp] = useState<string>(String(enHpPct));
  const [myHp, setMyHp] = useState<string>(String(myActive?.currentHp ?? 0));
  const [observedDmg, setObservedDmg] = useState<string>(String(myDamageDealt));
  const [myEng, setMyEng] = useState<string>(String(myActive?.energy ?? 0));
  const [enEng, setEnEng] = useState<string>(String(enActive?.energy ?? 0));

  // 1.5s 自动确认（关键事件不自动）
  useEffect(() => {
    if (expanded || isKey) return;
    startTsRef.current = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTsRef.current;
      const pct = Math.max(0, 100 - (elapsed / autoConfirmMs) * 100);
      setProgress(pct);
      if (elapsed >= autoConfirmMs) {
        onConfirm(null);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [expanded, isKey, autoConfirmMs, onConfirm]);

  // applyCorrection wrapped in useCallback — 只在 form 值或 props 变化时重建
  const applyCorrection = useCallback(() => {
    const correction: Correction = {};
    const enPct = parseInt(enemyHp, 10);
    if (!isNaN(enPct) && enPct !== enHpPct) correction.enemyHpPercent = enPct;
    const myAbs = parseInt(myHp, 10);
    if (!isNaN(myAbs) && myAbs !== (myActive?.currentHp ?? 0)) correction.myHpAbsolute = myAbs;
    const obs = parseInt(observedDmg, 10);
    if (!isNaN(obs) && obs !== myDamageDealt) correction.observedDamage = obs;
    const me = parseInt(myEng, 10);
    if (!isNaN(me) && me !== (myActive?.energy ?? 0)) correction.myEnergy = me;
    const ee = parseInt(enEng, 10);
    if (!isNaN(ee) && ee !== (enActive?.energy ?? 0)) correction.enemyEnergy = ee;

    // 写入观测日志（含技能上下文供 P3 反推用）
    if (correction.observedDamage !== undefined && enActive && myActive) {
      // 从 lastLog.enemyAction 取敌方本回合用的技能
      const lastLog = battle.log[battle.log.length - 1];
      const enAction = lastLog?.enemyAction;
      const enMove = enAction?.type === "move" ? enAction.move : null;
      const enMonster = enActive.monster;
      const myMonster = myActive.monster;
      // STAB：技能属性匹配攻击方主属性或副属性
      const stab = !!(enMove?.move_type && enMonster && (
        enMove.move_type.name === enMonster.main_type?.name ||
        enMove.move_type.name === enMonster.sub_type?.name
      ));
      // 属性克制
      const defTypes = myMonster
        ? [myMonster.main_type, myMonster.sub_type].filter(Boolean) as any[]
        : [];
      const eff = enMove?.move_type && defTypes.length > 0
        ? getTypeEffectiveness(enMove.move_type.name, defTypes)
        : 1;
      // 防守方对应防御值（按敌方技能 category 取我方 物防/魔防）
      const cat = enMove?.move_category;
      const defStat = cat === "Physical Attack" ? myActive.baseStats?.phyDef
        : cat === "Magic Attack" ? myActive.baseStats?.magDef
        : undefined;
      recordObservation({
        turn: battle.turn,
        attackerSide: "enemy",
        attackerName: enMonster?.localized?.zh?.name || "?",
        defenderName: myMonster?.localized?.zh?.name || "?",
        moveName: enMove?.localized?.zh?.name,
        movePower: enMove?.power || undefined,
        moveCategory: cat,
        stab,
        typeEffectiveness: eff,
        defenderDef: defStat,
        observedDamage: correction.observedDamage,
        predictedDamage: predictedDamage ?? myDamageDealt,
        defMaxHp: myActive.maxHp,
      });
    }
    onConfirm(Object.keys(correction).length > 0 ? correction : null);
  }, [enemyHp, myHp, observedDmg, myEng, enEng, enHpPct, myDamageDealt, myActive, enActive, battle, predictedDamage, onConfirm]);

  // 键盘快捷键 — 仅在 expanded / callbacks 变化时重建（不随 setProgress 重注册）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "Enter") {
        e.preventDefault();
        if (expanded) {
          applyCorrection();
        } else {
          onConfirm(null);
        }
      } else if (e.key.toLowerCase() === "e" && !expanded) {
        e.preventDefault();
        setExpanded(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (expanded) setExpanded(false);
        else onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [expanded, onConfirm, onCancel, applyCorrection]);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-3 pointer-events-none">
      <div className="max-w-3xl mx-auto pointer-events-auto">
        <div className={`rounded-xl shadow-xl border-2 ${
          isKey ? "border-red-300 bg-red-50" :
          expanded ? "border-amber-300 bg-amber-50" :
          "border-zinc-200 bg-white"
        } overflow-hidden`}>
          {/* 进度条（顶部薄条，仅非展开+非关键事件时显示） */}
          {!expanded && !isKey && (
            <div className="h-1 bg-zinc-100">
              <div className="h-full bg-indigo-400 transition-[width] duration-75" style={{ width: `${progress}%` }} />
            </div>
          )}
          {!expanded ? (
            <div className="px-4 py-2.5 flex items-center gap-3">
              <span className={`text-sm font-medium ${isKey ? "text-red-700" : "text-zinc-700"}`}>
                {isKey ? `⚠️ 关键事件：${keyEvent}` : `回合 ${battle.turn} 已结算`}
              </span>
              <span className="text-xs text-zinc-500">
                敌方 ≈{enHpPct}%   ·   我方 {myActive?.currentHp}/{myActive?.maxHp}
              </span>
              <span className="flex-1" />
              {isKey ? (
                <button onClick={() => onConfirm(null)}
                  className="text-xs px-3 py-1 rounded bg-red-500 text-white hover:bg-red-600 font-medium">
                  Enter 确认
                </button>
              ) : (
                <button onClick={() => onConfirm(null)}
                  className="text-xs px-3 py-1 rounded border border-zinc-200 text-zinc-500 hover:bg-zinc-50">
                  Enter 确认
                </button>
              )}
              <button onClick={() => setExpanded(true)}
                className="text-xs px-3 py-1 rounded border border-amber-200 text-amber-600 hover:bg-amber-50">
                E 修改
              </button>
            </div>
          ) : (
            <div className="px-4 py-3 space-y-2">
              <p className="text-xs font-semibold text-amber-700">修正回合 {battle.turn} 实际数值</p>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <label className="flex flex-col gap-1">
                  <span className="text-zinc-500">敌方 HP</span>
                  <div className="flex items-center gap-1">
                    <input type="number" value={enemyHp} onChange={(e) => setEnemyHp(e.target.value)}
                      className="w-14 px-2 py-1 rounded border border-zinc-200 text-zinc-700 text-right" />
                    <span className="text-zinc-400">%</span>
                  </div>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-zinc-500">我方 HP</span>
                  <div className="flex items-center gap-1">
                    <input type="number" value={myHp} onChange={(e) => setMyHp(e.target.value)}
                      className="w-16 px-2 py-1 rounded border border-zinc-200 text-zinc-700 text-right" />
                    <span className="text-zinc-400">/{myActive?.maxHp}</span>
                  </div>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-zinc-500">实际伤害（敌→我）</span>
                  <input type="number" value={observedDmg} onChange={(e) => setObservedDmg(e.target.value)}
                    className="w-16 px-2 py-1 rounded border border-zinc-200 text-zinc-700 text-right" />
                </label>
              </div>
              {showAdvanced && (
                <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-amber-200">
                  <label className="flex items-center gap-1.5">
                    <span className="text-zinc-500">我方能量</span>
                    <input type="number" value={myEng} onChange={(e) => setMyEng(e.target.value)}
                      className="w-12 px-2 py-1 rounded border border-zinc-200 text-zinc-700 text-right" />
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span className="text-zinc-500">敌方能量</span>
                    <input type="number" value={enEng} onChange={(e) => setEnEng(e.target.value)}
                      className="w-12 px-2 py-1 rounded border border-zinc-200 text-zinc-700 text-right" />
                  </label>
                </div>
              )}
              <div className="flex items-center gap-2 pt-1">
                <button onClick={applyCorrection}
                  className="text-xs px-3 py-1 rounded bg-amber-500 text-white hover:bg-amber-600 font-medium">应用</button>
                <button onClick={() => setExpanded(false)}
                  className="text-xs px-3 py-1 rounded border border-zinc-200 text-zinc-500 hover:bg-zinc-50">取消</button>
                <button onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-xs px-2 py-1 text-amber-500 hover:text-amber-700">
                  {showAdvanced ? "▴ 收起高级" : "▸ 高级（能量/buff）"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
