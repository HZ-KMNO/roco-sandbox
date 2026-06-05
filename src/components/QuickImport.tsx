import { useState, useRef, useCallback } from "react";
import type { Monster } from "../lib/types";
import { Icon } from "./Icon";
import monstersData from "../data/monsters_list.json";
import monstersDetail from "../data/monsters_detail.json";
import { parseOfficialTeamLine, parseMagicItemLine, type ParsedTeamLine } from "../lib/officialFormatParser";
import Tesseract from "tesseract.js";

const monsters = monstersData as Monster[];
const detailMap = new Map((monstersDetail as Monster[]).map((m) => [m.id, m]));

const monsterByName = new Map<string, Monster[]>();
for (const m of monsters) {
  if (detailMap.get(m.id)?.is_leader_form) continue;
  const key = m.localized.zh.name;
  const list = monsterByName.get(key) || [];
  list.push(m);
  monsterByName.set(key, list);
}

export type QuickImportMember = ParsedTeamLine;

interface Props {
  label: string;
  onImport: (monsters: Monster[]) => void;
  onImportFullMembers?: (members: ParsedTeamLine[], magicItem?: string, failedNames?: string[]) => void;
}

type ImportMode = "formula" | "image";

const parseFormula = (text: string) => {
  const found: Monster[] = [];
  const fullMembers: QuickImportMember[] = [];
  const notFound: string[] = [];
  if (/^###\s/m.test(text) || /#\s[一-鿿（）\w]+：[一-鿿]+血脉、\{/.test(text)) {
    const magic = parseMagicItemLine(text);
    const lines = text.split('\n').filter(l => l.includes('：') && l.includes('血脉') && l.includes('{'));
    for (const line of lines) {
      const fullMember = parseOfficialTeamLine(line.trim());
      if (fullMember) { fullMembers.push(fullMember); found.push(fullMember.monster); continue; }
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
      if (found.length > 0) return { found, fullMembers, notFound };
    }
  }
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
    if (found.length > 0) return { found, fullMembers, notFound };
  }
  return { found, fullMembers, notFound };
};

export function QuickImport({ label, onImport, onImportFullMembers }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode>("formula");
  const [formulaText, setFormulaText] = useState("");
  const [ocrImage, setOcrImage] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState("");
  const [loading, setLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<Monster[]>([]);
  const [foundMembers, setFoundMembers] = useState<ParsedTeamLine[]>([]);
  const [foundMagic, setFoundMagic] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleParse = (text: string) => {
    setError(null);
    setLoading(true);
    const result = parseFormula(text);
    setFound(result.found);
    setFoundMembers(result.fullMembers || []);
    setFoundMagic((result as any).magic || null);
    setNotFound(result.notFound);
    setLoading(false);
  };

  const handleFormulaSubmit = () => {
    if (!formulaText.trim()) return;
    handleParse(formulaText);
  };

  const runOCR = async (imgSrc: string) => {
    setLoading(true);
    setError(null);
    setOcrProgress(0);
    try {
      const { data: { text } } = await Tesseract.recognize(imgSrc, 'chi_sim+eng', {
        logger: (m) => { if (m.status === 'recognizing text') setOcrProgress(Math.round(m.progress * 100)); },
      });
      setOcrText(text);
      handleParse(text);
    } catch (e) {
      setError("识别失败: " + String(e));
      setLoading(false);
    }
  };

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      setOcrImage(src);
      runOCR(src);
    };
    reader.readAsDataURL(file);
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) handleFile(file);
        return;
      }
    }
  }, [handleFile]);

  const handleClose = () => {
    setIsOpen(false);
    setFormulaText("");
    setOcrImage(null);
    setOcrText("");
    setFound([]);
    setFoundMembers([]);
    setFoundMagic(null);
    setNotFound([]);
    setError(null);
    setLoading(false);
    setOcrProgress(0);
  };

  const handleConfirm = () => {
    if (foundMembers.length > 0 && onImportFullMembers) {
      const magicId = foundMagic === "进化之力" ? "evolution_power" : foundMagic === "愿力强化" ? "willpower_enhancement" : undefined;
      onImportFullMembers(foundMembers, magicId, notFound);
      handleClose();
      return;
    }
    if (found.length > 0) {
      onImport(found);
      handleClose();
    }
  };

  return (
    <>
      <button onClick={() => setIsOpen(true)}
        className="text-xs px-2 py-0.5 rounded border border-dashed border-zinc-300 text-zinc-400 hover:border-indigo-300 hover:text-indigo-500 flex items-center gap-1"
        title={`导入${label}`}>
        <Icon name="edit" size={12} />导入
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={handleClose}>
          <div className="bg-white rounded-xl border border-zinc-300 shadow-xl p-4 w-[440px] max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-zinc-700">导入配队 - {label}</h4>
              <button onClick={handleClose} className="text-zinc-400 hover:text-zinc-600"><Icon name="cross" size={16} /></button>
            </div>

            {/* Mode tabs */}
            <div className="flex gap-1 mb-3 bg-zinc-100 rounded-lg p-0.5">
              <button onClick={() => setMode("formula")}
                className={`flex-1 text-xs py-1.5 rounded-md ${mode === "formula" ? "bg-white text-zinc-800 shadow-sm font-medium" : "text-zinc-500"}`}>
                📝 公式导入
              </button>
              <button onClick={() => { setMode("image"); setOcrImage(null); setOcrText(""); }}
                className={`flex-1 text-xs py-1.5 rounded-md ${mode === "image" ? "bg-white text-zinc-800 shadow-sm font-medium" : "text-zinc-500"}`}>
                📷 截图识别
              </button>
            </div>

            {mode === "formula" ? (
              <div>
                <textarea value={formulaText} onChange={(e) => setFormulaText(e.target.value)}
                  placeholder="粘贴官方分享格式或队伍代码"
                  className="w-full h-32 text-xs p-3 border border-zinc-300 rounded-lg resize-none outline-none focus:border-indigo-300" />
                <button onClick={handleFormulaSubmit}
                  className="w-full mt-2 text-sm py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600">
                  解析代码
                </button>
              </div>
            ) : (
              <div onPaste={handlePaste} tabIndex={0} className="focus:outline-none">
                {!ocrImage ? (
                  <div className="border-2 border-dashed border-zinc-200 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-300"
                    onClick={() => inputRef.current?.click()}>
                    <p className="text-sm text-zinc-400 mb-1">📷 在此区域按 Ctrl+V 粘贴阵容截图</p>
                    <p className="text-xs text-zinc-300">或点击选择图片文件</p>
                  </div>
                ) : (
                  <div>
                    <img src={ocrImage} className="w-full rounded border border-zinc-200 mb-2 max-h-48 object-contain bg-zinc-50" alt="阵容截图" />
                    {loading && (
                      <div className="text-xs text-indigo-500 text-center py-2">
                        {ocrProgress > 0 ? `识别中... ${ocrProgress}%` : "识别中..."}
                      </div>
                    )}
                    {ocrText && (
                      <div className="mt-2">
                        <p className="text-xs text-zinc-500 mb-1">识别结果（可编辑后重新解析）：</p>
                        <textarea value={ocrText} onChange={(e) => setOcrText(e.target.value)}
                          className="w-full h-24 text-xs p-2 border border-zinc-300 rounded-lg resize-none outline-none focus:border-indigo-300" />
                        <button onClick={() => handleParse(ocrText)}
                          className="w-full mt-1 text-xs py-1.5 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600">
                          重新解析
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <input ref={inputRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </div>
            )}

            {loading && !ocrImage && <p className="text-sm text-zinc-500 text-center py-2">识别中...</p>}
            {error && <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-600 mt-2">{error}</div>}

            {found.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-xs text-zinc-500">识别到 {found.length} 只精灵：</p>
                {found.map((m, i) => (
                  <div key={i} className="text-sm text-green-700 font-medium flex items-center gap-2">
                    <span>{i + 1}.</span>
                    <span className={`text-xs px-1.5 rounded-full ${
                      m.main_type.name === "Fire" ? "bg-red-100 text-red-600"
                      : m.main_type.name === "Water" ? "bg-blue-100 text-blue-600"
                      : "bg-zinc-100 text-zinc-600"
                    }`}>{m.main_type.localized.zh}</span>
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
