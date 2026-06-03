import { useState, useRef, useEffect } from "react";
import type { TurnRecord } from "../lib/battleTimeline";

interface Props {
  records: TurnRecord[];
  currentTurn: number;
  onCorrectTurn: (turn: number, mode: "thisOnly" | "cascade") => void;
}

export function TurnTimeline({ records, currentTurn, onCorrectTurn }: Props) {
  const [openTurn, setOpenTurn] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // 当回合变化时自动滚到最右
  useEffect(() => {
    if (!collapsed && scrollerRef.current) {
      scrollerRef.current.scrollLeft = scrollerRef.current.scrollWidth;
    }
  }, [records.length, collapsed]);

  if (records.length === 0) return null;

  const renderActionLabel = (rec: TurnRecord) => {
    const my = rec.myAction;
    const en = rec.enemyAction;
    const fmt = (a: typeof my) => {
      if (a.type === "move") return a.move?.localized?.zh?.name?.slice(0, 4) || "?";
      if (a.type === "switch") return "换";
      if (a.type === "focus") return "蓄";
      return "防";
    };
    return `${fmt(my)} / ${fmt(en)}`;
  };

  const hpAfter = (rec: TurnRecord, side: "my" | "enemy") => {
    const team = side === "my" ? rec.stateAfter.myTeam : rec.stateAfter.enemyTeam;
    const idx = side === "my" ? rec.stateAfter.myActive : rec.stateAfter.enemyActive;
    const b = team[idx];
    if (!b) return 0;
    return Math.round(((b.currentHp ?? b.maxHp) / b.maxHp) * 100);
  };

  // 折叠时只显示徽章 + 展开按钮
  if (collapsed) {
    return (
      <div className="bg-white border border-zinc-200 rounded-lg px-2 py-1 shadow-sm flex items-center gap-2">
        <button
          onClick={() => setCollapsed(false)}
          className="text-[11px] text-zinc-500 hover:text-zinc-700 flex items-center gap-1"
          title="展开时间线"
        >
          <span>▸</span>
          <span>时间线 ({records.length} 回合)</span>
        </button>
        <div className="flex-1 flex gap-0.5 overflow-hidden">
          {records.slice(-8).map((rec) => (
            <span
              key={rec.turn}
              className={`text-[9px] px-1 rounded ${
                rec.turn === currentTurn ? "bg-indigo-100 text-indigo-700" : "bg-zinc-100 text-zinc-500"
              }`}
            >
              R{rec.turn}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-2 shadow-sm">
      <div className="flex items-center gap-2 mb-1.5">
        <button
          onClick={() => setCollapsed(true)}
          className="text-xs text-zinc-500 hover:text-zinc-700 flex items-center gap-1"
        >
          <span>▾</span>
          <span className="font-medium">回合时间线</span>
        </button>
        <span className="text-[10px] text-zinc-400">点击任一回合可事后修正</span>
      </div>
      <div ref={scrollerRef} className="flex gap-1 overflow-x-auto pb-1">
        {records.map((rec) => {
          const isCurrent = rec.turn === currentTurn;
          return (
            <button key={rec.turn} onClick={() => setOpenTurn(openTurn === rec.turn ? null : rec.turn)}
              className={`shrink-0 flex flex-col gap-0.5 px-2 py-1 rounded border text-left transition-colors ${
                openTurn === rec.turn ? "border-amber-400 bg-amber-50" :
                isCurrent ? "border-indigo-300 bg-indigo-50" :
                "border-zinc-200 hover:border-zinc-300"
              }`}>
              <span className="text-[10px] font-semibold text-zinc-700">R{rec.turn}</span>
              <span className="text-[10px] text-zinc-500 whitespace-nowrap">{renderActionLabel(rec)}</span>
              <span className="text-[10px] text-zinc-400">我{hpAfter(rec, "my")}% 敌{hpAfter(rec, "enemy")}%</span>
            </button>
          );
        })}
      </div>
      {openTurn !== null && (
        <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs space-y-1.5">
          <p className="text-amber-700 font-medium">修正回合 R{openTurn}</p>
          <p className="text-amber-500 text-[11px]">
            你想如何处理？后续回合的推演结果可能与实际不同。
          </p>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => { onCorrectTurn(openTurn, "thisOnly"); setOpenTurn(null); }}
              className="text-[11px] px-2.5 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-100">
              只改这条
            </button>
            <button onClick={() => { onCorrectTurn(openTurn, "cascade"); setOpenTurn(null); }}
              className="text-[11px] px-2.5 py-1 rounded bg-amber-500 text-white hover:bg-amber-600">
              重算 R{openTurn} 至当前
            </button>
            <button onClick={() => setOpenTurn(null)}
              className="text-[11px] px-2.5 py-1 rounded border border-zinc-200 text-zinc-500 hover:bg-zinc-50">
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
