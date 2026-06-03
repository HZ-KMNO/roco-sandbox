/**
 * AI 多轮对话会话管理
 *
 * 设计：preload(turnId=0) 永不撤销 + turnEntries[] 按 turnId 累加
 * 撤销：truncateAfter(turnId) 移除该回合及之后所有 user/assistant 对
 * 持久化：localStorage 按 battleId 存储
 *
 * 与 simulator 的回合快照对齐：撤销 BattleState 与裁 AI 历史用同一个 targetTurnId
 */

export interface TurnEntry {
  turnId: number;            // 1, 2, 3, ... preload 是 0 不入此数组
  userPrompt: string;
  assistantReply: string;
  battleStateHash?: string;  // 关联当时的 BattleState 快照（用于一致性校验）
  aborted?: boolean;         // 请求被撤销中断时标记，不参与后续对话
  ts: number;
}

export interface AISession {
  battleId: string;
  preloadSystemPrompt: string;  // turnId=0，开局注入的全队信息
  turnEntries: TurnEntry[];
  createdAt: number;
}

// ── 模块级状态：当前活动会话 ──
let currentSession: AISession | null = null;

const STORAGE_PREFIX = "roco_ai_session_";
const ACTIVE_KEY = "roco_ai_session_active";

function genBattleId(): string {
  return `b_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getCurrentSession(): AISession | null {
  return currentSession;
}

export function startSession(systemPrompt: string): AISession {
  const session: AISession = {
    battleId: genBattleId(),
    preloadSystemPrompt: systemPrompt,
    turnEntries: [],
    createdAt: Date.now(),
  };
  currentSession = session;
  persist();
  return session;
}

export function appendTurn(
  turnId: number,
  userPrompt: string,
  assistantReply: string,
  battleStateHash?: string,
): TurnEntry | null {
  if (!currentSession) return null;
  const entry: TurnEntry = { turnId, userPrompt, assistantReply, battleStateHash, ts: Date.now() };
  // 同一 turnId 已存在则覆盖（重做或重新触发场景）
  const existingIdx = currentSession.turnEntries.findIndex((e) => e.turnId === turnId);
  if (existingIdx >= 0) currentSession.turnEntries[existingIdx] = entry;
  else currentSession.turnEntries.push(entry);
  // 保持升序
  currentSession.turnEntries.sort((a, b) => a.turnId - b.turnId);
  persist();
  return entry;
}

/**
 * 撤销到目标回合：保留 turnId < targetTurnId 的所有 entry，移除其余
 * 返回被移除的 entries（供 UI 显示"已撤销 N 条"提示）
 */
export function truncateAfter(targetTurnId: number): TurnEntry[] {
  if (!currentSession) return [];
  const removed = currentSession.turnEntries.filter((e) => e.turnId >= targetTurnId);
  currentSession.turnEntries = currentSession.turnEntries.filter((e) => e.turnId < targetTurnId);
  persist();
  return removed;
}

export function resetSession(): void {
  if (currentSession) {
    try { localStorage.removeItem(STORAGE_PREFIX + currentSession.battleId); } catch {}
  }
  currentSession = null;
  try { localStorage.removeItem(ACTIVE_KEY); } catch {}
}

/**
 * 构造发送给 DeepSeek 的 messages（不含本回合的新 user prompt，调用方自行追加）
 * 排除 aborted 的条目
 */
export function buildMessages(): { role: "system" | "user" | "assistant"; content: string }[] {
  if (!currentSession) return [];
  const msgs: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: currentSession.preloadSystemPrompt },
  ];
  for (const e of currentSession.turnEntries) {
    if (e.aborted) continue;
    msgs.push({ role: "user", content: e.userPrompt });
    msgs.push({ role: "assistant", content: e.assistantReply });
  }
  return msgs;
}

export function markAborted(turnId: number): void {
  if (!currentSession) return;
  const entry = currentSession.turnEntries.find((e) => e.turnId === turnId);
  if (entry) {
    entry.aborted = true;
    persist();
  }
}

function persist(): void {
  if (!currentSession) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + currentSession.battleId, JSON.stringify(currentSession));
    localStorage.setItem(ACTIVE_KEY, currentSession.battleId);
  } catch { /* quota or disabled */ }
}

export function restoreActiveSession(): AISession | null {
  try {
    const battleId = localStorage.getItem(ACTIVE_KEY);
    if (!battleId) return null;
    const raw = localStorage.getItem(STORAGE_PREFIX + battleId);
    if (!raw) return null;
    const session = JSON.parse(raw) as AISession;
    if (!session.battleId || !Array.isArray(session.turnEntries)) return null;
    currentSession = session;
    return session;
  } catch {
    return null;
  }
}

/** 仅用于 UI 展示：返回所有 turnId 的 assistantReply 列表 */
export function getAssistantHistory(): { turnId: number; reply: string; aborted?: boolean }[] {
  if (!currentSession) return [];
  return currentSession.turnEntries.map((e) => ({
    turnId: e.turnId,
    reply: e.assistantReply,
    aborted: e.aborted,
  }));
}

/**
 * 事后修正消息推送（P4）
 * 在指定回合插入一条 user "修正"消息 + 对应的 assistant placeholder
 * 让后续 AI 调用知道 R{turn} 的数据被修正过
 */
export function injectCorrectionMessage(
  turnId: number,
  correctionDescription: string,
): void {
  if (!currentSession) return;
  const entry = currentSession.turnEntries.find((e) => e.turnId === turnId);
  if (entry) {
    // 已有该 turn 的对话 → 在 userPrompt 末尾追加修正说明
    entry.userPrompt = `${entry.userPrompt}\n\n[事后修正] ${correctionDescription}`;
  } else {
    // 没有该 turn 的对话 → 插一条修正注记
    currentSession.turnEntries.push({
      turnId,
      userPrompt: `[事后修正] ${correctionDescription}`,
      assistantReply: "（已记录修正，下回合分析将基于修正数据）",
      ts: Date.now(),
    });
    currentSession.turnEntries.sort((a, b) => a.turnId - b.turnId);
  }
  persist();
}
