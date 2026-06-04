<p align="center">
  <img src="public/logo.png" alt="洛克沙盘 Logo" width="120" />
</p>

<p align="center">
  <img src="public/sponsor-qr.jpg" alt="赞助二维码" width="180" /><br/>
  <sub>如果这个项目对你有帮助，欢迎请作者喝杯咖啡</sub>
</p>

> 🐱 关注开发者谢谢喵：[迁米不](https://space.bilibili.com/353064098)

# 🏰 洛克沙盘 (Roco Sandbox)

> 洛克王国：世界 6v6 单打 PVP 对战辅助桌面应用

回合推演 + AI 多轮教练 + 伤害反推引擎 + 实战数据修正，让你在对战中少猜拳、多读牌。

[English](./README.md) | 简体中文

---

## 🎯 这是什么？

一款 Tauri 桌面应用，在你 PVP 对战时作为**旁观辅助**使用。游戏画面告诉你 HP 和伤害数字，**洛克沙盘告诉你这些数字背后的含义**：

- 对方大概率是什么性格 + 个体值
- 接下来 3 个回合谁赢面大
- AI 教练建议你这回合怎么操作
- 系统推演和实际不一致时该如何修正

所有建议基于 **PVP导论**：不是简单比伤害数字，而是从 **Check/Counter 对位关系**、**冗余战术**、**非冗余战术** 角度分析。

---

## ✨ 核心功能

### 🤖 DeepSeek AI 多轮教练

| 特性 | 说明 |
|------|------|
| 真·对话记忆 | AI 记住 R2 给的建议，在 R3 能接着上文推理 |
| 开局预加载 | 第一只敌方出场就注入全队上下文（system prompt 缓存） |
| 撤销同步 | 回退回合 → AI 对话历史同步裁掉对应轮次 |
| 会话持久化 | localStorage 存储，刷新/重启不丢失 |
| 实际成本 | 约 ¥0.001/回合，一局 30 回合 ≈ 一分钱 |

### 🎯 1.5 秒核对条

每回合执行后底部弹出确认条：

```
回合 3 已结算 │ 敌方 ≈42%  我方 3120/3500 │ [Enter 确认] [E 修改]
█████████░  (1.5s)
```

- **普通回合**：1.5 秒自动确认，零打扰
- **关键事件**（KO / 首领化 / 印记层数变化 / 冰冻）→ 红色，**必须手动 Enter**
- **按 E**：展开修正面板 — 改敌方 HP%、我方 HP、实际伤害、双方能量
- **AI 延迟发送**：修正完成后才触发 AI 调用，保证 AI 收到的是你确认过的数据

### 🧠 伤害反推引擎

输入实际伤害 → 反向解伤害公式 → 得到敌方攻击数值区间：

```
伤害公式:  damage = floor(round(atk × power × stab × typeEff × 37/41) / def)
反推:      atk ≈ damage × def / (power × stab × typeEff × 37/41)
```

每次观测收窄区间。3-5 次修正后，引擎能锁定敌方的**性格名**（如「偏执」）并将攻击数值精确到 ±10。

敌方面板紫色徽章实时显示：
> `物攻≈195·偏执 / 魔攻≈210·专注（5次）`

### ⏪ 回合时间线 + 级联回算

每回合录入（状态前、状态后、双方动作）→ 底部时间线横条：

- **点击任一历史回合** → 「只改这条」（仅覆盖显示）/ 「重算到当前」（用修正状态重跑后续所有回合）
- 重算时复用存档的 action 序列，用户的操作决策保留不变
- AI 收到修正通知消息：`[事后修正] R3 数据已修正：敌方实际HP 60% 而非 50%`

### 📥 公式导入

粘贴官方分享格式（B 站配队帖常见）：

```
### 平衡帅魔偶
# 魔法：进化之力
#
# 海豹船长：武系血脉、{斩断、听桥、力量增效、水刃}
# 帅帅魔偶：恶系血脉、{借用、借用、借用、贪婪}
# 食尘短绒：翼系血脉、{贮藏、地刺、倾泻、遁地}
# 棋绮后：首领血脉、{影袭、鸣沙陷阱、先发制人、听桥}
# 针叶巡林：翼系血脉、{地刺、刺藤、截拳、光合作用}
# 帕帕斯卡：水系血脉、{钢铁洪流、轴承支撑、倾泻、风起}
```

→ **一键创建队伍**：6 只精灵全部到位，含技能、血脉、推荐性格/个体值（沿进化链 + 首领反查自动匹配）、魔法道具。

> ⚠️ **注意**：由官方公式导入的精灵性格与个体值使用的是推荐配置，如与实际不符请手动调整。

### 🔍 全局拼音首字母搜索

输入每个汉字的拼音首字母即可定位：
- `t` → 听桥、隐藏条款（任何首字母含 t 的技能）
- `tq` → 听桥（两字首字母 t + q）
- `dm` → 迪莫
- `sg` → 筛管奔流

全部 6 个搜索框均支持：技能搜索、精灵搜索、图鉴、配队、借用 ⊕ 弹窗、敌方系别展开。

### ⚙️ 特性系统（~95% 覆盖）

5 大特性处理器 + 2 个补充系统：

| 处理器 | 触发时机 | 覆盖 |
|--------|----------|------|
| `applyEntryTraits` | 入场 | ~30 种效果 |
| `applyExitTraits` | 离场 | 清除/转移 |
| `applyEndOfTurnTraits` | 回合结束 | 合拍/奉献/自动脱离 |
| `applyCounterTraits` | 应对成功 | 反击增益 |
| `applyTraitOnAttack` | 攻击时 | ~25 种模式 |
| **咕噜球** | 入场 | 14 种球（普通/国王/美妙/调温/光合/网兜/绝缘/淘沙/变幻/暗星/好战/捕光/棱镜） |
| **兽花蕾血脉** | 入场 | 18 种系别效果 |

持久字段（换人保留）：蓄电池 `entryCount`、魔力值 `magicPoints`。其他全部换人清除 + 重入时重算。

特殊特性实现：
- **盲从**（帅帅魔偶）：允许携带多个借用/复写/取念 + 非幻系技能能耗-2

### 🎨 6 个功能 Tab

| Tab | 说明 |
|-----|------|
| **对战** | 实时对局流程 — 我方/敌方面板 + AI 建议 + 三栏对局分析（技能/魔法/换人） |
| **复盘** | 粘贴对战记录 → 结构化回合展示 → AI 复盘分析，最多保存 50 条 |
| **配队** | 热门配队（在线 + 缓存）、公式导入、模板保存/管理 |
| **图鉴** | 525 精灵按编号排列，默认迪莫 ⭐，含 B 站推荐（性格/个体/配招） |
| **教程** | 阅读器模式 — 左侧目录 + 居中正文，论文排版 + 三线表 + 术语表 |
| **设置** | DeepSeek Key、建议模式（AI/规则）、段位、主题、字号、数据管理 |

---

## 🛠 技术栈

| 层 | 技术 |
|----|------|
| 桌面壳 | **Tauri 2**（Rust） |
| 前端 | **React 19** + **TypeScript**（strict 模式） |
| 样式 | **Tailwind CSS v4** + `@tailwindcss/typography` |
| 构建 | **Vite 7** |
| AI | **DeepSeek**（多轮 Chat Completions） |
| 数据源 | 精灵/技能/属性数据（525 精灵 / 501 技能 / 18 系） |

Rust 后端是**直通层** — 所有逻辑在 TypeScript 中，方便快速迭代。

---

## 🚀 快速开始

### 环境要求

- **Node.js 18+**（开发用 24）
- **Rust**（构建 Tauri 需要）
- **Windows 10/11**（主要平台，macOS/Linux 理论可用但未测试）

### 安装 & 运行

```bash
git clone https://github.com/HZ-KMNO/roco-sandbox.git
cd roco-sandbox
npm install

# 方式一：完整 Tauri 桌面应用（推荐）
npm run tauri dev

# 方式二：仅前端（更快热重载，无原生 API）
npm run dev
# 然后浏览器打开 http://localhost:1420
```

### 构建 Windows 安装包

```bash
npm run tauri build
# 输出: %CARGO_TARGET_DIR%/roco-sandbox/release/bundle/
```

> 💡 下载安装包后如果 Windows 提示「Windows 已保护你的电脑」/「无法识别发布者」，
> 请点击**「更多信息」→「仍要运行」**。这是因为我们没有购买昂贵的代码签名证书
> （每年 $200+），但软件本身是安全无害的开源项目。
```

### 配置 AI（可选但推荐）

没有 AI Key 时，会自动降级为规则引擎建议。要启用 AI：

1. 在 [DeepSeek 开放平台](https://platform.deepseek.com) 获取 Key（[API 教程](https://api-docs.deepseek.com/zh-cn/)）
2. 应用 → 设置 → 🤖 AI → 粘贴 Key
3. 添加第一只敌方精灵 → AI 自动预加载 → 每回合后自动给出建议

---

## 🏗 项目结构

```
src/
├── App.tsx                          # 6-Tab 壳 + 设置 + AI 编排
├── components/
│   ├── TeamPanel.tsx                # 我方队伍（多队伍 + localStorage）
│   ├── EnemyPanel.tsx               # 敌方队伍
│   ├── MatchupAnalysis.tsx          # 三栏对局分析
│   ├── TurnCorrectionBar.tsx        # 1.5s 核对条
│   ├── TurnTimeline.tsx             # 回合时间线 + 级联回算 UI
│   ├── QuickImport.tsx              # 公式导入
│   ├── MonsterCard.tsx              # 精灵卡（性格/个体/技能/血脉/球）
│   ├── FeaturedTeams.tsx            # 配队 Tab
│   ├── Pokedex.tsx                  # 图鉴 Tab
│   ├── Tutorial.tsx                 # 教程阅读器
│   └── ReplayAnalysis.tsx           # 复盘 Tab
└── lib/
    ├── calculator.ts                # 伤害公式 + 种族值计算
    ├── battle.ts                    # 对位分析（Check/Counter/KO 回合数）
    ├── simulator.ts                 # 完整回合引擎 + 5 大特性处理器
    ├── aiAdvisor.ts                 # DeepSeek 客户端（多轮对话）
    ├── aiSession.ts                 # 会话持久化 + 撤销裁剪
    ├── observations.ts              # 伤害观测日志
    ├── damageReverser.ts            # 反推引擎（atk 区间 + 性格名）
    ├── battleTimeline.ts            # 回合记录 + 级联回算
    ├── officialFormatParser.ts      # 官方分享格式共享解析器
    ├── popularStats.ts              # 推荐配置（进化链 + 首领反查）
    └── pinyinSearch.ts              # 拼音首字母搜索
```

完整架构详见 [`CLAUDE.md`](./CLAUDE.md)。

---

## 📐 单回合数据流

```
用户选择双方技能 → Space（执行）
  └→ resolveTurn(state, myAction, enemyAction) → 新 BattleState
     └→ TurnRecord 写入时间线
        └→ TurnCorrectionBar 弹出（1.5s 进度条）
           ├─ 关键事件？ → 红色，必须 Enter
           ├─ 按 E → 展开修正面板
           │   ├─ 改 HP%/伤害/能量
           │   └─ 应用 → 写回 BattleState + recordObservation()
           └─ 自动/手动确认 → onTurnExecuted
              └→ getTurnAdvice(snap, {turnId})
                 └→ DeepSeek 接收完整多轮 messages
                    └→ AI 气泡 + localStorage 持久化

撤销 → undoLastTurn → prevBattle + truncateAfter(turnId) + AI 提示条
事后修正 → TurnTimeline → 「只改这条 / 重算到当前」
```

---

## 📖 详细使用教程

完整的使用教程请查看：[`docs/app-guide.md`](./docs/app-guide.md)

教程涵盖：
- 快速开始（3 步上手）
- 6 个 Tab 的完整操作流程
- 进阶功能（公式导入 / 拼音搜索 / 核对条 / 时间线 / 反推引擎 / AI 教练）
- 快捷键一览
- 常见问题 FAQ

在应用内也可直接查看：教程 Tab → 使用教程（置顶第一项）。

---

## 💡 使用技巧

| 场景 | 操作 |
|------|------|
| 快速执行回合 | 选完双方技能后按 **Space** |
| 取消当前选择 | **Esc** |
| 撤销上回合 | 点击 ↩ 按钮 |
| 开局设为首发 | 双击精灵卡 ⭐ |
| 快捷搜索技能 | 直接输入拼音首字母 |
| AI 模式切换 | 设置 → 建议模式 → AI/规则引擎 |
| 修正系统推演 | 核对条弹出时按 E |
| 跨回合修正 | 时间线展开 → 点击 R{N} |

---

## 🤝 参与贡献

欢迎 PR：
- 特性边界 case 修复（~5% 未覆盖）
- 更多精灵的性格/个体推荐数据
- 教程内容修正
- 新功能建议（Issues）

---

## 📜 许可

本项目仅供**学习和个人使用**。精灵名称、技能描述、角色设计等游戏数据属于《洛克王国：世界》原版权方，请勿商用分发。

> ⚠️ **禁止盗用，禁止商用。** 本软件为免费开源项目，如您是通过付费渠道获得此软件，请举报商家并要求退款。

---

---

## 🙏 致谢

- **[洛手配队器](https://rkteambuilder.com/dex?types=1)** — 配队参考工具
- **[离愁轩 wiki](https://wiki.lcx.cab/lk/skill_list.php)** — 权威精灵/技能数据来源
- **[洛克王国：世界 PVP 助手](https://rocopvp.tzrain.wiki)** — 热门配队数据 API
- **B 站 UP 主 [卓帅丶](https://space.bilibili.com/13884095)** — 全精灵配置推荐（[《洛克王国：世界》全精灵用法分析！](https://www.bilibili.com/video/BV1Y4SfBCEwz/)）
- **DeepSeek** — 低成本多轮对话 LLM API
- **洛克王国：世界 PVP 社区** — 战术理论贡献者
- **B 站 UP 主 [WwlWss](https://space.bilibili.com/1972682)** 的 [战术理论](https://www.bilibili.com/video/BV12BduBCEmL/) — 核心战术框架

---

⚔️ 祝对战愉快 — 记住，最强的玩家知道什么时候该不信模拟器。
