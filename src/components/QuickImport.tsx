import { useState, useRef, useCallback } from "react";
import type { Monster } from "../lib/types";
import { Icon } from "./Icon";
import monstersData from "../data/monsters_list.json";
import monstersDetail from "../data/monsters_detail.json";
import { parseOfficialTeamLine, parseMagicItemLine, type ParsedTeamLine } from "../lib/officialFormatParser";
import jsQR from "jsqr";

const monsters = monstersData as Monster[];
const detailMap = new Map((monstersDetail as Monster[]).map((m) => [m.id, m]));

const monsterByName = new Map<string, Monster[]>();

for (const m of monsters) {
  // 排除首领化形态（只能通过进化之力变身）
  if (detailMap.get(m.id)?.is_leader_form) continue;
  const key = m.localized.zh.name;
  const list = monsterByName.get(key) || [];
  list.push(m);
  monsterByName.set(key, list);
}

// 向后兼容别名
export type QuickImportMember = ParsedTeamLine;

interface Props {
  label: string;
  onImport: (monsters: Monster[]) => void;
  // 可选：拿到完整 member（含技能/性格/血脉 + magic）— 我方用
  onImportFullMembers?: (members: ParsedTeamLine[], magicItem?: string) => void;
}

export function QuickImport({ label, onImport, onImportFullMembers }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"qr" | "formula">("qr");
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [formulaText, setFormulaText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<Monster[]>([]);
  const [foundMembers, setFoundMembers] = useState<ParsedTeamLine[]>([]);
  const [foundMagic, setFoundMagic] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const parseQRData = (text: string) => {
    const found: Monster[] = [];
    const fullMembers: QuickImportMember[] = [];
    const notFound: string[] = [];
    // Official format: # 精灵名：血脉、{技能1、技能2、技能3、技能4}
    if (/^###\s/m.test(text) || /#\s[一-鿿（）\w]+：[一-鿿]+血脉、\{/.test(text)) {
      const magic = parseMagicItemLine(text);
      const lines = text.split('\n').filter(l => l.includes('：') && l.includes('血脉') && l.includes('{'));
      for (const line of lines) {
        // 优先用全字段解析（含技能/性格/血脉）
        const fullMember = parseOfficialTeamLine(line.trim());
        if (fullMember) {
          fullMembers.push(fullMember);
          found.push(fullMember.monster);
          continue;
        }
        // 退化：精灵名匹配
        const nameMatch = line.match(/^#\s*([一-鿿（）\w]+)：/);
        if (nameMatch) {
          const name = nameMatch[1];
          const matchess = monsterByName.get(name);
          if (matchess && matchess.length > 0) found.push(matchess[0]);
          else notFound.push(name);
        }
      }
      if (found.length > 0) return { found, fullMembers, notFound, magic };
    }
    // Combined format: official header + our data (skip to our data part)
    if (/---\s*完整数据/.test(text)) {
      const dataPart = text.split(/---\s*完整数据/)[1] || "";
      if (dataPart && /[一-鿿（）\w]+#\d+/.test(dataPart)) {
        const blocks = dataPart.split(/\|\|/).filter(Boolean);
        for (const block of blocks) {
          const nameMatch = block.match(/^([一-鿿（）\w]+)#\d+/);
          if (nameMatch) {
            const name = nameMatch[1];
            const matchess = monsterByName.get(name);
            if (matchess && matchess.length > 0) found.push(matchess[0]);
            else notFound.push(name);
          }
        }
        if (found.length > 0) return { found, notFound };
      }
    }
    // Our format: 名称#编号//性格//（物攻+10）（速度+10）技能1/技能2/技能3/技能4
    if (/[一-鿿（）\w]+#\d+/.test(text)) {
      const blocks = text.split(/\n\s*\n|\|\|/).filter(Boolean);
      for (const block of blocks) {
        const nameMatch = block.match(/^([一-鿿（）\w]+)#\d+/);
        if (nameMatch) {
          const name = nameMatch[1];
          const matchess = monsterByName.get(name);
          if (matchess && matchess.length > 0) found.push(matchess[0]);
          else notFound.push(name);
        }
      }
      if (found.length > 0) return { found, notFound };
    }
    // Try rkteambuilder import URL format
    const urlMatch = text.match(/[?&]t=([^&]+)/);
    if (urlMatch) {
      try {
        const jsonStr = atob(urlMatch[1]);
        const data = JSON.parse(jsonStr);
        if (data.m && Array.isArray(data.m)) {
          for (const m of data.m) {
            const mid = String(m.id);
            // Look up by id in monsters list
            const monster = monsters.find(mm => String(mm.id) === mid);
            if (monster) found.push(monster);
            else notFound.push(mid);
          }
        }
      } catch { /* fall through */ }
    }
    // Try raw JSON
    if (found.length === 0) {
      try {
        const data = JSON.parse(text);
        const builds = data.team?.builds || data.builds || [];
        for (const build of builds) {
          const name = build.name || "";
          const matches = monsterByName.get(name);
          if (matches && matches.length > 0) found.push(matches[0]);
          else notFound.push(name);
        }
        if (data.names && Array.isArray(data.names)) {
          for (const name of data.names) {
            const matches = monsterByName.get(name);
            if (matches && matches.length > 0) found.push(matches[0]);
            else notFound.push(name);
          }
        }
      } catch { /* fall through */ }
    }
    // Fallback: text split
    if (found.length === 0) {
      const parts = text.split(/[,，\s\n\|\/]+/).filter(Boolean);
      for (const part of parts) {
        const name = part.trim();
        const matches = monsterByName.get(name);
        if (matches && matches.length > 0) {
          if (!found.some(m => m.id === matches[0].id)) found.push(matches[0]);
        } else if (name.length >= 2) notFound.push(name);
      }
    }
    return { found, fullMembers, notFound };
  };

  const handleFormulaSubmit = () => {
    if (!formulaText.trim()) return;
    setError(null);
    setLoading(true);
    const result = parseQRData(formulaText);
    setFound(result.found);
    setFoundMembers(result.fullMembers || []);
    setFoundMagic((result as any).magic || null);
    setNotFound(result.notFound);
    setLoading(false);
  };

  const handleClose = () => {
    setIsOpen(false);
    setFormulaText("");
    setMode("qr");
    setIsOpen(false);
    setImageSrc(null);
    setFound([]);
    setFoundMembers([]);
    setFoundMagic(null);
    setNotFound([]);
    setError(null);
    setLoading(false);
  };

  const decodeQR = (img: HTMLImageElement): string | null => {
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(imageData.data, canvas.width, canvas.height);
    return result?.data || null;
  };

  const handleFile = useCallback((file: File) => {
    setError(null);
    setFound([]);
    setNotFound([]);
    setLoading(true);

    const img = new Image();
    const previewUrl = URL.createObjectURL(file);
    img.onload = () => {
      setImageSrc(previewUrl);
      // Try decode QR
      const text = decodeQR(img);
      if (text) {
        const result = parseQRData(text);
        setFound(result.found);
        setNotFound(result.notFound);
        setLoading(false);
      } else {
        setError("未识别到二维码");
        setLoading(false);
      }
    };
    img.src = previewUrl;
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    // Try text first (rkteambuilder import code)
    const text = e.clipboardData.getData("text/plain");
    if (text) {
      e.preventDefault();
      setImageSrc(null);
      setError(null);
      setLoading(true);
      const result = parseQRData(text);
      setFound(result.found);
      setNotFound(result.notFound);
      setLoading(false);
      return;
    }
    // Try image (QR code)
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) handleFile(file);
        break;
      }
    }
  }, [handleFile]);

  const handleConfirm = () => {
    if (foundMembers.length > 0 && onImportFullMembers) {
      // 我方：完整导入（含技能/性格/血脉/魔法）
      const magicId = foundMagic === "进化之力" ? "evolution_power" : foundMagic === "愿力强化" ? "willpower_enhancement" : undefined;
      onImportFullMembers(foundMembers, magicId);
      setIsOpen(false);
      setImageSrc(null);
      setFound([]);
      setFoundMembers([]);
      setFoundMagic(null);
      setNotFound([]);
      setError(null);
      return;
    }
    if (found.length > 0) {
      onImport(found);
      setIsOpen(false);
      setImageSrc(null);
      setFound([]);
      setFoundMembers([]);
      setNotFound([]);
      setError(null);
    }
  };

  const handleOpen = (m: "qr" | "formula") => { setMode(m); setIsOpen(true); };

  return (
    <>
      <button onClick={() => handleOpen("qr")}
        className="text-xs px-2 py-0.5 rounded border border-dashed border-zinc-300 text-zinc-400 hover:border-indigo-300 hover:text-indigo-500 flex items-center gap-1"
        title={`扫码导入${label}`}>
扫码
      </button>
      <button onClick={() => handleOpen("formula")}
        className="text-xs px-2 py-0.5 rounded border border-dashed border-zinc-300 text-zinc-400 hover:border-indigo-300 hover:text-indigo-500 flex items-center gap-1"
        title={`公式导入${label}`}>
        <Icon name="edit" size={12} />公式导入
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={handleClose}>
          <div className="bg-white rounded-xl border border-zinc-300 shadow-xl p-4 w-96 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-zinc-700">{mode === "qr" ? "扫码导入" : "公式导入"} - {label}</h4>
              <button onClick={handleClose} className="text-zinc-400 hover:text-zinc-600"><Icon name="cross" size={16} /></button>
            </div>

            {mode === "qr" ? (
              <div onPaste={handlePaste} tabIndex={0} className="focus:outline-none">
                {!imageSrc ? (
                  <div className="border-2 border-dashed border-zinc-200 rounded-lg p-6 text-center cursor-pointer hover:border-indigo-300"
                    onClick={() => inputRef.current?.click()}>
                    <p className="text-sm text-zinc-400">点击此处后按 Ctrl+V 粘贴二维码截图</p>
                    <p className="text-xs text-zinc-300 mt-1">或点击选择图片文件</p>
                  </div>
                ) : (
                  <img src={imageSrc} className="w-full rounded border border-zinc-200 mb-2" alt="导入图片" />
                )}
                <input ref={inputRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </div>
            ) : (
              <div>
                <textarea value={formulaText} onChange={(e) => setFormulaText(e.target.value)}
                  placeholder="粘贴队伍代码，每只精灵一行或 || 分隔&#10;格式：名称#编号//性格//（个体值1+10）（...）技能1/技能2/技能3/技能4"
                  className="w-full h-32 text-xs p-3 border border-zinc-300 rounded-lg resize-none outline-none focus:border-indigo-300" />
                <button onClick={handleFormulaSubmit}
                  className="w-full mt-2 text-sm py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600">
                  解析代码
                </button>
              </div>
            )}

            {loading && <p className="text-sm text-zinc-500 text-center py-2">识别中...</p>}

            {error && <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-600 mt-2">{error}</div>}

            {found.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-xs text-zinc-500">识别到 {found.length} 只精灵：</p>
                {found.map((m, i) => (
                  <div key={i} className="text-sm text-green-700 font-medium flex items-center gap-2">
                    <span>{i + 1}.</span>
                    <span className={`text-xs px-1.5 rounded-full ${m.main_type.name === "Fire" ? "bg-red-100 text-red-600" : m.main_type.name === "Water" ? "bg-blue-100 text-blue-600" : m.main_type.name === "Grass" ? "bg-green-100 text-green-600" : "bg-zinc-100 text-zinc-600"}`}>
                      {m.main_type.localized.zh}</span>
                    <span>{m.localized.zh.name}</span>
                  </div>
                ))}
              </div>
            )}

            {notFound.length > 0 && <div className="mt-2"><p className="text-xs text-amber-600">未匹配：{notFound.join("、")}</p></div>}

            {found.length > 0 && (
              <button onClick={handleConfirm} className="w-full mt-3 text-sm py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600">
                确认导入 ({found.length} 只)
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
