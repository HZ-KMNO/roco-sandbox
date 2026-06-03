/**
 * 回合时间线 — 保留每回合完整快照与动作序列，支持级联回算
 *
 * 数据流：
 *   executeTurn 时 push 一条 TurnRecord
 *   用户在 R5 时点开 R3 修正：
 *     - 模式 A "只改这条"：覆盖 R3 的 stateAfter 显示，不动后续
 *     - 模式 B "重算后续"：用 R3 修正后的状态 + R3..R5 的 actions 依次 resolveTurn
 */

import type { BattleState, Action } from "./simulator";
import { resolveTurn } from "./simulator";

export interface TurnRecord {
  turn: number;
  stateBefore: BattleState;       // 执行前快照（含 turn = N）
  stateAfter: BattleState;        // 执行后快照（含 turn = N+1）
  myAction: Action;
  enemyAction: Action;
  ts: number;
}

export interface BattleTimeline {
  records: TurnRecord[];
}

const KEY = "roco_battle_timeline";

let cached: BattleTimeline | null = null;

function load(): BattleTimeline {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    cached = raw ? JSON.parse(raw) : { records: [] };
  } catch {
    cached = { records: [] };
  }
  return cached!;
}

function persist(): void {
  try { localStorage.setItem(KEY, JSON.stringify(cached)); } catch { /* noop */ }
}

export function appendTurnRecord(rec: Omit<TurnRecord, "ts">): void {
  const tl = load();
  // 同一 turn 已存在则覆盖（重做）
  const idx = tl.records.findIndex((r) => r.turn === rec.turn);
  const entry: TurnRecord = { ...rec, ts: Date.now() };
  if (idx >= 0) {
    tl.records[idx] = entry;
    // 修改了某回合 → 后续都失效，截掉
    tl.records = tl.records.slice(0, idx + 1);
  } else {
    tl.records.push(entry);
  }
  persist();
}

export function getTimeline(): TurnRecord[] {
  return [...load().records];
}

export function resetTimeline(): void {
  cached = { records: [] };
  persist();
}

/**
 * 级联回算：从 targetTurn 起重新跑 resolveTurn
 *
 * @param targetTurn 修正的回合号
 * @param correctedBefore 该回合修正后的 stateBefore
 * @returns 重算到当前回合的最新 BattleState；同时更新 timeline
 */
export function replayFromTurn(
  targetTurn: number,
  correctedBefore: BattleState,
): BattleState | null {
  const tl = load();
  const idx = tl.records.findIndex((r) => r.turn === targetTurn);
  if (idx < 0) return null;

  let state = correctedBefore;
  const newRecords: TurnRecord[] = tl.records.slice(0, idx);

  for (let i = idx; i < tl.records.length; i++) {
    const old = tl.records[i];
    const next = resolveTurn(state, old.myAction, old.enemyAction);
    newRecords.push({
      turn: old.turn,
      stateBefore: state,
      stateAfter: next,
      myAction: old.myAction,
      enemyAction: old.enemyAction,
      ts: Date.now(),
    });
    state = next;
  }

  cached = { records: newRecords };
  persist();
  return state;
}

/**
 * 仅覆盖某回合 stateAfter（"只改这条"模式）—— 不重算后续
 */
export function overrideTurnAfter(turn: number, stateAfter: BattleState): void {
  const tl = load();
  const rec = tl.records.find((r) => r.turn === turn);
  if (!rec) return;
  rec.stateAfter = stateAfter;
  persist();
}
