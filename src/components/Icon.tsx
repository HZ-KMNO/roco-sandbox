interface Props {
  name: "sword" | "book" | "users" | "school" | "play" | "settings" | "pin" | "refresh" | "search" | "cross" | "chevron-down" | "chevron-right" | "plus" | "trash" | "import" | "x" | "edit";
  size?: number;
  className?: string;
}

// Simplified icon paths optimized for small sizes (24x24 viewBox)
const paths: Record<Props["name"], string> = {
  // ⚔️ 对战 — two crossed swords
  sword: "M3 3l8 8M21 21l-8-8M13 3l8 8M3 21l8-8M12 2v20",

  // 📖 图鉴 — book
  book: "M4 4h4a4 4 0 0 1 4 4v13a4 4 0 0 0-4-4H4V4zM20 4h-4a4 4 0 0 0-4 4v13a4 4 0 0 1 4-4h4V4z",

  // 👥 配队 — two people
  users: "M17 20v-1a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v1M9 11a3 3 0 1 0 0-6M23 20v-1a3 3 0 0 0-2-2.8M16 5a3 3 0 0 1 0 5.8",

  // ⚙️ 设置 — gear
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",

  // 📌 置顶 — thumbtack
  pin: "M12 2v4l3 5h4l-3 4v7l-4-2-4 2v-7l-3-4h4l3-5V2z",

  // 🔄 刷新
  refresh: "M1 4v5h5M23 20v-5h-5M4.9 9a8 8 0 0 1 14.2 2M19.1 15a8 8 0 0 1-14.2-2",

  // 🔍 搜索
  search: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3",

  // ✕ 关闭
  cross: "M18 6 6 18M6 6l12 12",
  x: "M18 6 6 18M6 6l12 12",

  // ▼ 展开
  "chevron-down": "M6 9l6 6 6-6",
  "chevron-right": "M9 18l6-6-6-6",

  // ＋ 添加
  plus: "M12 5v14M5 12h14",

  // 🗑 删除
  trash: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",

  // 📥 导入
  import: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",

  // ▶️ 复盘
  play: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM10 8l6 4-6 4V8z",

  // ✏️ 编辑
  edit: "M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z",

  // 🎓 教程
  school: "M22 10l-10-5L2 10l10 5 10-5zM6 12v4a6 3 0 0 0 12 0v-4",
};

export function Icon({ name, size = 16, className = "" }: Props) {
  const strokeW = size <= 12 ? 2.5 : size >= 18 ? 1.8 : 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeW}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
