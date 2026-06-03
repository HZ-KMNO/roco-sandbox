import { useState, useMemo, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
// @ts-ignore
import playbookMd from "../../skills/rock-kingdom-pvp-advisor/references/pvp-advisor-playbook.md?raw";
// @ts-ignore
import textbookMd from "../../skills/rock-kingdom-pvp-advisor/references/pvp-textbook-extract.md?raw";
// @ts-ignore
import skillMd from "../../skills/rock-kingdom-pvp-advisor/SKILL.md?raw";

type Doc = { key: string; label: string; desc: string; content: string };

const docs: Doc[] = [
  { key: "playbook", label: "速查手册", desc: "对战决策速查", content: playbookMd },
  { key: "textbook", label: "完整教材", desc: "从入门到精通", content: textbookMd },
  { key: "skill", label: "使用说明", desc: "教练模式指南", content: skillMd },
];

function extractTOC(md: string): { level: number; text: string; anchor: string }[] {
  const headings = md.match(/^#{1,4}\s+.+$/gm) || [];
  return headings.map(h => {
    const level = h.match(/^(#{1,4})/)![1].length;
    const text = h.replace(/^#{1,4}\s+/, "");
    const anchor = text.toLowerCase().replace(/[^\w一-鿿]+/g, "-").replace(/-+$/g, "");
    return { level, text, anchor };
  });
}

export function Tutorial() {
  const [active, setActive] = useState("textbook");
  const [progress, setProgress] = useState(0);
  const [tocCollapsed, setTocCollapsed] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const current = docs.find((d) => d.key === active) || docs[0];
  const toc = useMemo(() => extractTOC(current.content), [current.key]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const handler = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      setProgress(Math.round((scrollTop / Math.max(1, scrollHeight - clientHeight)) * 100));
    };
    el.addEventListener("scroll", handler);
    return () => el.removeEventListener("scroll", handler);
  }, [current.key]);

  const scrollToSection = (anchor: string) => {
    const el = contentRef.current;
    if (!el) return;
    const target = el.querySelector(`[id="${anchor}"]`);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="flex gap-0 max-h-[78vh]">
      {/* Left: Book selector + TOC */}
      <div className={`${tocCollapsed ? "w-12" : "w-56"} shrink-0 flex flex-col gap-3 bg-white rounded-l-xl border border-r-0 border-zinc-200 p-3 transition-all duration-200 overflow-hidden`}>
        {/* Collapse toggle */}
        <button onClick={() => setTocCollapsed(!tocCollapsed)}
          className="text-xs text-zinc-400 hover:text-zinc-600 self-end">
          {tocCollapsed ? "▶" : "◀ 收起"}
        </button>

        {!tocCollapsed && (
          <>
            {/* Book selector */}
            <div className="space-y-1.5">
              {docs.map((d) => (
                <button key={d.key} onClick={() => setActive(d.key)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                    active === d.key
                      ? "bg-indigo-50 border-indigo-200 shadow-sm"
                      : "bg-white border-zinc-100 hover:border-zinc-200 hover:bg-zinc-50"
                  }`}
                >
                  <div className={`text-sm font-medium ${active === d.key ? "text-indigo-700" : "text-zinc-700"}`}>{d.label}</div>
                  <div className="text-xs text-zinc-400 mt-0.5">{d.desc}</div>
                </button>
              ))}
            </div>

            {/* TOC */}
            {toc.length > 0 && (
              <div className="flex-1 overflow-y-auto min-h-0">
                <div className="text-xs font-medium text-zinc-500 mb-1.5 pl-1">目录</div>
                <nav className="space-y-0 border-l-2 border-zinc-100">
                  {toc.map((h, i) => (
                    <button key={i}
                      onClick={() => scrollToSection(h.anchor)}
                      className={`w-full text-left text-xs truncate block px-2 py-0.5 transition-colors hover:bg-zinc-50 ${
                        h.level === 1 ? "font-medium text-zinc-700"
                        : h.level === 2 ? "text-zinc-500 pl-4"
                        : "text-zinc-400 pl-6"
                      }`}
                      title={h.text}
                    >{h.text}</button>
                  ))}
                </nav>
              </div>
            )}
          </>
        )}
        {tocCollapsed && (
          <div className="flex-1 flex flex-col items-center gap-1 pt-2">
            {docs.map((d) => (
              <button key={d.key} onClick={() => setActive(d.key)}
                title={d.label}
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium border transition-colors ${
                  active === d.key ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-white border-zinc-100 text-zinc-400 hover:border-zinc-200"
                }`}
              >{d.label[0]}</button>
            ))}
          </div>
        )}
      </div>

      {/* Right: Reading area */}
      <div className="flex-1 flex flex-col min-w-0 bg-white rounded-r-xl border border-l-0 border-zinc-200 overflow-hidden">
        {/* Progress bar */}
        <div className="h-0.5 bg-zinc-100 shrink-0">
          <div className="h-full bg-indigo-400 transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>

        {/* Content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-12 py-10">
            <article className="prose prose-slate prose-base
              prose-headings:font-semibold prose-headings:text-zinc-800
              prose-headings:border-b prose-headings:border-zinc-100 prose-headings:pb-2 prose-headings:mb-4 prose-headings:mt-8
              prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg
              prose-p:text-base prose-p:leading-7 prose-p:text-zinc-700 prose-p:mb-5
              prose-li:text-sm prose-li:leading-6 prose-li:text-zinc-700 prose-li:my-1.5
              prose-code:text-sm prose-code:bg-zinc-100 prose-code:text-zinc-600 prose-code:px-2 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
              prose-table:text-sm prose-table:w-full
              prose-th:font-medium prose-th:text-zinc-700 prose-th:px-3 prose-th:py-2 prose-th:border-b-2 prose-th:border-zinc-400
              prose-td:px-3 prose-td:py-2 prose-td:border-b prose-td:border-zinc-200
              [&_table]:border-t-2 [&_table]:border-t-zinc-600 [&_table]:border-b-2 [&_table]:border-b-zinc-600
              [&_thead]:border-b-2 [&_thead]:border-zinc-400
              prose-a:text-indigo-600 prose-a:no-underline hover:prose-a:underline
              prose-blockquote:border-l-4 prose-blockquote:border-indigo-300 prose-blockquote:bg-indigo-50/30 prose-blockquote:px-5 prose-blockquote:py-3 prose-blockquote:rounded-r prose-blockquote:not-italic
              prose-strong:text-zinc-800
              prose-hr:border-zinc-200
            ">
              <ReactMarkdown
                components={{
                  h1: ({ children, ...props }: any) => {
                    const text = String(children);
                    const anchor = text.toLowerCase().replace(/[^\w一-鿿]+/g, "-").replace(/-+$/g, "");
                    return <h1 id={anchor} {...props}>{children}</h1>;
                  },
                  h2: ({ children, ...props }: any) => {
                    const text = String(children);
                    const anchor = text.toLowerCase().replace(/[^\w一-鿿]+/g, "-").replace(/-+$/g, "");
                    return <h2 id={anchor} {...props}>{children}</h2>;
                  },
                  h3: ({ children, ...props }: any) => {
                    const text = String(children);
                    const anchor = text.toLowerCase().replace(/[^\w一-鿿]+/g, "-").replace(/-+$/g, "");
                    return <h3 id={anchor} {...props}>{children}</h3>;
                  },
                }}
              >
                {current.content}
              </ReactMarkdown>
            </article>

            {progress > 0 && progress < 100 && (
              <div className="text-center text-xs text-zinc-300 mt-12">{progress}%</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
