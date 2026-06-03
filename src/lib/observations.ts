/**
 * 伤害观测日志 — 收集用户在核对条里输入的"实际伤害"
 *
 * 用途：
 * 1. 当下回合：若实际伤害 != 系统预测，提示用户系统估算偏差
 * 2. P3 反推引擎：累积多次观测后，反向求解敌方魔攻/物攻区间，锁定性格/个体值
 */

export interface DamageObservation {
  turn: number;
  attackerSide: "my" | "enemy";
  attackerName: string;
  defenderName: string;
  moveName?: string;          // 已知技能时填入
  observedDamage: number;     // 用户填写的实际数值
  predictedDamage?: number;   // 系统当时的预测值（用于偏差对比）
  defMaxHp?: number;          // 防守方最大 HP（计算 % 用）
  // ── 反推引擎所需上下文（P3） ──
  movePower?: number;
  moveCategory?: string;       // "Physical Attack" / "Magic Attack" / "Status"
  stab?: boolean;
  typeEffectiveness?: number;
  defenderDef?: number;        // 防守方对应的物防或魔防
  ts: number;
}

const KEY = "roco_damage_observations";

let cached: DamageObservation[] | null = null;

function load(): DamageObservation[] {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    cached = raw ? JSON.parse(raw) : [];
  } catch {
    cached = [];
  }
  return cached!;
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cached || []));
  } catch { /* noop */ }
}

export function recordObservation(ob: Omit<DamageObservation, "ts">): void {
  const list = load();
  list.push({ ...ob, ts: Date.now() });
  // 保留最近 200 条
  if (list.length > 200) list.splice(0, list.length - 200);
  persist();
}

export function getAllObservations(): DamageObservation[] {
  return [...load()];
}

export function getObservationsFor(attackerName: string): DamageObservation[] {
  return load().filter((o) => o.attackerName === attackerName);
}

export function clearObservations(): void {
  cached = [];
  persist();
}
