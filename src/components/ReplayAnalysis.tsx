import { useState, useEffect, useMemo } from "react";
import { getApiKey, getTurnAdvice } from "../lib/aiAdvisor";

interface Turn {
  text: string;
  damage?: { side: "my" | "enemy"; amount: number; target: string };
  heal?: { side: "my" | "enemy"; amount: string };
  energy?: { side: "my" | "enemy"; amount: string };
  status?: { side: "my" | "enemy"; text: string };
  switch?: { side: "my" | "enemy"; text: string };
}

interface Replay {
  id: string;
  name: string;
  text: string;
  turns: Turn[];
  createdAt: string;
}

function parseTurns(text: string): Turn[] {
  const turnBlocks = text.split(/\n(?=回合 \d+[:：])/);
  const turns: Turn[] = [];
  for (const block of turnBlocks) {
    if (!block.trim()) continue;
    const turn: Turn = { text: block.trim() };
    const dmgMatch = block.match(/造成\s*(\d+)\s*伤害/);
    if (dmgMatch) {
      turn.damage = {
        side: block.includes("我方") && !block.includes("敌方") ? "my" : "enemy",
        amount: parseInt(dmgMatch[1]),
        target: block.includes("敌方") ? "敌方" : "我方",
      };
      turn.damage.side = turn.damage.target === "敌方" ? "my" : "enemy";
    }
    const healMatch = block.match(/回复(\d+)生命/);
    if (healMatch) turn.heal = { side: block.includes("我方") ? "my" : "enemy", amount: healMatch[1] };
    const engMatch = block.match(/回复(\d+)能量/);
    if (engMatch) turn.energy = { side: block.includes("我方") ? "my" : "enemy", amount: engMatch[1] };
    if (block.includes("灼烧")) turn.status = { side: block.includes("我方") ? "my" : "enemy", text: "灼烧" };
    if (block.includes("中毒")) turn.status = { side: block.includes("我方") ? "my" : "enemy", text: "中毒" };
    if (block.includes("冰冻")) turn.status = { side: block.includes("我方") ? "my" : "enemy", text: "冰冻" };
    if (block.includes("换上")) turn.switch = { side: block.includes("我方") ? "my" : "enemy", text: block };
    turns.push(turn);
  }
  return turns;
}

const STORAGE_KEY = "roco_replays";

export function ReplayAnalysis() {
  const [input, setInput] = useState("");
  const [replays, setReplays] = useState<Replay[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Replay | null>(null);
  const [aiAdvice, setAiAdvice] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(replays));
  }, [replays]);

  const handleSave = () => {
    if (!input.trim()) return;
    const turns = parseTurns(input);
    const now = new Date();
    const label = `复盘 ${now.getMonth()+1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2,"0")}`;
    const replay: Replay = {
      id: Date.now().toString(36),
      name: label,
      text: input,
      turns,
      createdAt: now.toISOString(),
    };
    setReplays(prev => [replay, ...prev].slice(0, 50));
    setInput("");
    setSelectedId(replay.id);
    setViewing(replay);
  };

  const selectReplay = (r: Replay) => {
    setSelectedId(r.id);
    setViewing(r);
  };

  const deleteReplay = (id: string) => {
    setReplays(prev => prev.filter(r => r.id !== id));
    if (selectedId === id) { setSelectedId(null); setViewing(null); }
  };

  // Statistics from saved replays
  const stats = useMemo(() => {
    if (replays.length === 0) return null;
    const totalTurns = replays.reduce((s, r) => s + r.turns.length, 0);
    const avgTurns = Math.round(totalTurns / replays.length);
    // Count damage dealt/received
    let myDmg = 0, enDmg = 0;
    for (const r of replays) {
      for (const t of r.turns) {
        if (t.damage) {
          if (t.damage.side === "my") myDmg += t.damage.amount;
          else enDmg += t.damage.amount;
        }
      }
    }
    return { count: replays.length, totalTurns, avgTurns, myDmg, enDmg };
  }, [replays]);

  return (
    <div className="flex gap-4 max-h-[75vh]">
      {/* Left panel: paste + saved list */}
      <div className="w-72 shrink-0 flex flex-col gap-3">
        <div className="bg-white rounded-xl border border-zinc-200 p-3 shadow-sm">
          <h3 className="text-sm font-medium text-zinc-700 mb-2">粘贴对战记录</h3>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="从对局分析中导出对战记录，粘贴到此处..."
            className="w-full text-xs p-2 border border-zinc-200 rounded-lg resize-none h-32 outline-none focus:border-indigo-300"
          />
          <button
            onClick={handleSave}
            disabled={!input.trim()}
            className="w-full mt-1.5 text-sm px-3 py-1.5 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-50"
          >保存复盘</button>
        </div>

        {/* Statistics */}
        {stats && (
          <div className="bg-white rounded-xl border border-zinc-200 p-2.5 shadow-sm">
            <h3 className="text-xs font-medium text-zinc-500 mb-1.5">数据统计</h3>
            <div className="grid grid-cols-3 gap-1 text-center">
              <div className="bg-zinc-50 rounded p-1.5">
                <div className="text-sm font-bold text-indigo-600">{stats.count}</div>
                <div className="text-[10px] text-zinc-400">对战场次</div>
              </div>
              <div className="bg-zinc-50 rounded p-1.5">
                <div className="text-sm font-bold text-indigo-600">{stats.avgTurns}</div>
                <div className="text-[10px] text-zinc-400">平均回合</div>
              </div>
              <div className="bg-zinc-50 rounded p-1.5">
                <div className="text-sm font-bold text-indigo-600">{stats.totalTurns}</div>
                <div className="text-[10px] text-zinc-400">总回合数</div>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto bg-white rounded-xl border border-zinc-200 shadow-sm">
          <div className="p-2 border-b border-zinc-100">
            <h3 className="text-xs font-medium text-zinc-500">历史复盘 ({replays.length})</h3>
          </div>
          {replays.length === 0 ? (
            <p className="text-xs text-zinc-400 text-center py-4">暂无记录</p>
          ) : (
            replays.map(r => (
              <button
                key={r.id}
                onClick={() => selectReplay(r)}
                className={`w-full text-left text-xs px-2.5 py-2 flex items-center justify-between border-b border-zinc-50 hover:bg-zinc-50 ${
                  selectedId === r.id ? "bg-indigo-50 border-l-2 border-l-indigo-400" : ""
                }`}
              >
                <span className="truncate flex-1">{r.name}</span>
                <span className="text-zinc-400 ml-1">{r.turns.length}回合</span>
                <button
                  onClick={e => { e.stopPropagation(); deleteReplay(r.id); }}
                  className="ml-1 text-zinc-300 hover:text-red-500"
                >×</button>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right panel: turn-by-turn view */}
      <div className="flex-1 min-w-0 bg-white rounded-xl border border-zinc-200 shadow-sm overflow-y-auto">
        {viewing ? (
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-zinc-800">{viewing.name}</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">{viewing.turns.length} 回合</span>
                {getApiKey() && (
                  <button
                    onClick={() => {
                      setAiLoading(true); setAiAdvice("");
                      const snap = {
                        turn: viewing.turns.length,
                        myActive: { name: "?", hp: 0, maxHp: 100, energy: 0, burnLayers: 0, poisonLayers: 0, freezeLayers: 0, regressionLayers: 0, defending: false, stunned: false, pctBuffs: "", traitLabels: "" },
                        enemyActive: { name: "?", hp: 0, maxHp: 100, energy: 0, burnLayers: 0, poisonLayers: 0, freezeLayers: 0, regressionLayers: 0, defending: false, stunned: false, pctBuffs: "" },
                        lastTurnEvents: "",
                        weather: "无", marks: "无", history: [],
                        myTeamAlive: [], enemyTeamAlive: [],
                        myMagicAvailable: "无",
                        mySkills: "", enemyObservedSkills: "",
                        matchupTip: "复盘分析", ruleSuggestion: viewing.text,
                      };
                      getTurnAdvice(snap).then(r => { setAiAdvice(r); setAiLoading(false); }).catch(() => { setAiAdvice("AI 请求失败"); setAiLoading(false); });
                    }}
                    disabled={aiLoading}
                    className="text-xs px-2 py-0.5 rounded border border-indigo-200 text-indigo-500 hover:bg-indigo-50 disabled:opacity-50"
                  >{aiLoading ? "分析中..." : "AI 复盘"}</button>
                )}
              </div>
            </div>
            {aiAdvice && (
              <div className="mb-3 text-xs leading-relaxed px-3 py-2 rounded bg-indigo-50 border border-indigo-100 text-indigo-800 whitespace-pre-wrap">
                {aiAdvice.replace(/\*\*|##|###/g, "")}
              </div>
            )}
            <div className="space-y-3">
              {viewing.turns.map((turn, i) => (
                <div key={i} className="border-l-2 border-indigo-200 pl-3">
                  <p className="text-xs font-medium text-zinc-500 mb-1">回合 {i + 1}</p>
                  <pre className="text-xs text-zinc-700 whitespace-pre-wrap font-sans leading-relaxed">
                    {turn.text.replace(/^回合 \d+[:：]\s*/m, "")}
                  </pre>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {turn.damage && (
                      <span className={`text-[10px] px-1 rounded ${turn.damage.side === "my" ? "bg-blue-50 text-blue-600" : "bg-red-50 text-red-600"}`}>
                        伤害 {turn.damage.amount}
                      </span>
                    )}
                    {turn.heal && (
                      <span className="text-[10px] px-1 rounded bg-green-50 text-green-600">回复 {turn.heal.amount}</span>
                    )}
                    {turn.energy && (
                      <span className="text-[10px] px-1 rounded bg-amber-50 text-amber-600">能量 {turn.energy.amount}</span>
                    )}
                    {turn.status && (
                      <span className="text-[10px] px-1 rounded bg-purple-50 text-purple-600">{turn.status.text}</span>
                    )}
                    {turn.switch && (
                      <span className="text-[10px] px-1 rounded bg-zinc-100 text-zinc-500">换人</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-zinc-400">
            {replays.length > 0 ? "选择一个复盘查看" : "粘贴对战记录开始复盘"}
          </div>
        )}
      </div>
    </div>
  );
}
