# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Commands

```bash
npm run dev                # Vite dev server on port 1420
npm run tauri dev          # Full Tauri desktop app with hot reload
npx tsc --noEmit           # Type check
npm run build              # tsc + vite build
npm run tauri build        # Build Windows exe → E:\rust-target\roco-pvp\release\bundle\
```

No test framework. No linter beyond TypeScript strict mode.

## Architecture

Tauri v2 + React 19 + TypeScript + Tailwind CSS v4 + `@tailwindcss/typography`. Rust backend is pass-through.

### Data layer (`src/data/`)

Static JSON from LCX (wiki.lcx.cab). **`pvp相关信息/精灵与技能全图鉴/lcx_skill_text.json` and `lcx_tujian_species_text.json` are authoritative.** Fix script: `scripts/fix_monster_data.py`.

| File | Contents |
|------|----------|
| `monsters_detail.json` | 525 monsters, 375 dex. 34 leaders marked via `leader_potential` + `leader_form_id` |
| `monsters_list.json` | Lightweight 525 entries. No trait/move_pool — use `detailMap` |
| `moves.json` | 501 moves |
| `types.json` | 18 combat types + Leader (首领血脉, bloodline only) |
| `pinyin_data.ts` | 1206 chars → pinyin |
| `monster_pinyin.json` / `skill_pinyin.json` | Per-ID pinyin |
| `evolution_chains.json` | `prevMap` (regression) + `finalMap` |
| `popular_stat_marks.json` | B站 60 monsters: personality + talent |
| `popular_moves.json` | B站 56 monsters: recommended 4-move sets |
| `popular_teams.json` | Cached team data from API |
| `personalities.json` | 30 personalities (±10%/+20%) |

### Core logic (`src/lib/`)

**calculator.ts** — Damage: `floor(round(atk × power × STAB × typeEff × 37/41) / def)`, STAB=1.25. `calcStats()` computes stats from base + personality + talent.

**battle.ts** — `analyzeMoves()`, `analyzeMatchup()` (check/counter/pressure/KO-turns).

**simulator.ts** — Full turn-based battle engine. `resolveTurn()` order:
```
Step 0: resolveRandomSkills()
Step 1: applyTransmission()
Step 2: Switch handling (clear pctBuffs, apply exit→entry traits)
Step 3: Quick Entry (迅捷, including trait-granted)
Step 4: Counter/interrupt + counter traits
Step 5: Move execution → damage + effects + applyTraitOnAttack
Step 6: End-of-turn traits, forceSwitch, stun/burn/poison tick
```

**Trait system** — Five handlers + two supplementals:
- `applyEntryTraits(battler, team, oppTeam, side, events)` — ~30 entry triggers
- `applyExitTraits(battler, side, events)` — 离场触发
- `applyEndOfTurnTraits(battle, events)` — 回合结束, 合拍, 奉献, 自动脱离等
- `applyCounterTraits(battler, side)` — 应对成功触发
- `applyTraitOnAttack(actor, target, move, side, events, targetSide)` — ~25 attack patterns (~95% trait coverage)
- `applyCaptureBallEffect()` — 捕球效果 (14 types)
- `applyBeastBloodlineEffect()` — 兽花蕾血脉 (18 types)
- `getTraitEffectLabels(battler)` → `TraitEffectLabel[]` — UI tags
- 盲从（帅帅魔偶）: `hasBlindObey()` + `getBlindObeyCostReduction()` — 非幻系技能能耗-2

**BattlerState persistent fields** (preserved on switch): `magicPoints`, `entryCount`. All other trait accumulations cleared on switch and recalculated on re-entry.

#### AI 多轮对话 (`aiSession.ts` + `aiAdvisor.ts`)

**aiSession.ts** — 多轮对话会话管理. `startSession(preload)` / `appendTurn(turnId, user, reply)` / `truncateAfter(turnId)` / `buildMessages()` → `[{system}, {user_R1}, {assist_R1}, ...]`. localStorage 持久化. `injectCorrectionMessage()` 用于事后修正通知 AI.

**aiAdvisor.ts** — `getTurnAdvice(snap, {turnId})` now sends full multi-turn history (via `buildMessages()`) so AI remembers previous rounds. Supports AbortController for cancelling in-flight requests. `preloadBattleContext()` starts a new session.

#### 伤害反推引擎 (`observations.ts` + `damageReverser.ts`)

**observations.ts** — `DamageObservation` 记录每次用户在核对条输入的"实际伤害"（含技能上下文：power/category/stab/eff/defenderDef）。喂给反推引擎.

**damageReverser.ts** — 解伤害公式逆方程 `atk ≈ damage × def / (power × stab × eff × 37/41)`. `solveAttackerAtk()` 单次→区间, `estimateAttackerStats()` 多次观测取交集→区间收窄. `estimatePersonalityName()` 用区间中点匹配 30 种性格中最接近的.

#### 回合时间线 (`battleTimeline.ts`)

`TurnRecord{turn, stateBefore, stateAfter, myAction, enemyAction}` 每回合 push. `replayFromTurn(targetTurn, correctedBefore)` 用 actions 序列重跑 resolveTurn. `overrideTurnAfter()` 仅覆盖单条.

#### 其他 lib

- **buildConverter.ts** — 将 popular_teams 的 statMarks/skillNames 转为 Personality/Talent/Move[]
- **popularStats.ts** — `getPopularPersonality(id)` / `getPopularTalent(id)` — 沿进化链 (`prevMap`) + 首领反查 (`leader_form_id`) 回溯推荐配置
- **pinyinSearch.ts** — `matchSkillName()` / `matchMonsterName()`. 字母前缀 + 任意位置子串匹配
- **fetcher.ts** — 在线拉取热门配队
- **teamPrediction.ts** — 队伍预测
- **typeColors.ts** — 18 系颜色常量

### Key types

- `Monster` — id, name, types, stats, trait, move_pool, dex_number, leader_potential, leader_form_id
- `BattlerState` — HP/energy, status, statStages, pctBuffs, moveSlots[], + trait persistent fields
- `BattleState` — teams, weather, marks, log, magic state
- `TeamMember` — `{ monster, personality, talent, selectedMoves, bloodline, captureBall?, beastBloodline? }`
- `TraitEffectLabel` — `{ label, tooltip, isPermanent }`
- `MoveEffect` — union including `randomSkill`, `teamShift`
- `DamageObservation` — turn/attacker/defender/move/observedDamage/predictedDamage/stab/eff/defenderDef
- `TurnRecord` — turn/stateBefore/stateAfter/myAction/enemyAction
- `TurnEntry` — turnId/userPrompt/assistantReply/battleStateHash/aborted/ts

### UI (6 tabs: 对战 | 复盘 | 配队 | 图鉴 | 教程 | 设置)

```
App.tsx
├── [对战]
│   ├── TeamPanel — multi-team localStorage, ⭐ starter (double-click)
│   │   ├── QuickImport: 公式导入 (官方 #格式→一键6只含技能/血脉/性格/魔法)
│   │   └── MonsterCard: stats, personality, talent, 天分等级
│   │       ├── [+复写][+借用][+取念] quick buttons (盲从可重复)
│   │       ├── 咕噜球 / 血脉 selectors
│   │       ├── MoveSearch → 拼音首字母过滤, 全技能池可选
│   │       └── Trait: static badge (traits are inherent)
│   ├── EnemyPanel — add monsters, popular personality/talent display
│   ├── 对局建议 — auto-preload on 1st enemy, auto AI after turn
│   │   ├── AI 建议（AI 模式）/ 规则引擎（规则模式）
│   │   ├── AI 对话历史折叠面板
│   │   └── 撤销提示条 ↩（灰色横线, 4s 自动消失）
│   └── MatchupAnalysis — 3-column: Skills | 魔法 | Switch
│       ├── TurnTimeline (默认折叠 ▸, 展开后点击 R{N} 事后修正)
│       ├── TurnCorrectionBar: 每回合1.5s进度条核对条
│       │   ├── 关键事件（KO/换人/印记层数变化/冰冻）→ 红色, 必须手动 Enter
│       │   └── E 展开修正面板（敌方HP%/我方HP/实际伤害/能量）
│       ├── HistoricalCorrectionPanel: 事后修正「只改这条 / 重算到当前」
│       ├── 敌方面板 attackEstimateLabel: 「物攻≈195·偏执（5次）」紫色徽章
│       ├── HP/energy quick-adjust, 撤销上回合, Space=execute, Esc=cancel
│       └── Trait labels: ⟳ green (蓄电池/magicPoints) / amber (others)
├── [复盘]
│   ├── 粘贴对战记录 → 解析回合 → localStorage (最多50条)
│   └── AI 复盘分析按钮, 结构化回合展示, 数据统计
├── [配队] — FeaturedTeams
│   ├── 导入官方分享格式 (# 海豹船长：武系血脉、{技1、技2、技3、技4})
│   ├── 拼音首字母搜索队伍/精灵名, 属性筛选
│   ├── 我的模板 (localStorage), 导入我方/敌方
│   └── 属性圆点预览, ♥喜欢数
├── [图鉴] — Pokedex sorted by dex, default 迪莫, ⭐=有推荐
│   └── Detail: 进化链(含首领👑), B站推荐(性格/个体/配招), 种族值, 技能池
├── [教程] — Reader: left TOC + right content, prose, 三线表, 论文格式
└── [设置] — 分组卡片
    ├── ⚔️ 对战: 建议模式(AI/规则), 段位模式(大师以下/大师以上)
    ├── 🎨 外观: 深色模式, 字号
    ├── 🤖 AI: DeepSeek API Key
    ├── 💾 数据: 清除 AI/复盘/模板, 重置所有
    └── 📦 关于: v0.1.0, 检查更新
```

### 对战数据流（P1-P4 改写后）

```
用户选择我方/敌方技能 → Space 执行回合
→ resolveTurn() → BattleState
→ TurnRecord 写入 battleTimeline
→ TurnCorrectionBar 弹出（1.5s 进度条）
   ├─ 关键事件？ → 红色，必须 Enter
   ├─ 用户按 E → 展开修正面板
   │   ├─ 改数值 → 写回 BattleState + recordObservation()
   │   └─ applyCorrection → handleCorrectionConfirm
   └─ 自动/手动确认 → onTurnExecuted
       → getTurnAdvice(snap, {turnId}) → DeepSeek 多轮 messages
       → saveAiAdvice → AI 气泡 + localStorage 持久化
撤销 → undoLastTurn → prevBattle + truncateAfter(turnId) + AI 提示条
事后修正 → TurnTimeline 点 R3 → 「只改这条 / 重算后续」
```

### 公式导入流程

QuickImport 支持两种模式：
1. **官方 # 格式**（我方 TeamPanel 点"公式导入"时):
   `# 海豹船长：武系血脉、{斩断、听桥、力量增效、水刃}` → 解析精灵名/血脉(/血系→MonsterType)/4招/性格(进化链回溯)/个体值
   `# 魔法：进化之力` → magicItem→"evolution_power"
   → onImportFullMembers → 一键新建队伍 + 切队 + 6 只全填好
2. **简易文本格式**（敌方 / 旧格式 fallback）:
   `精灵名#编号//性格//个体值技能1/技能2/...` → 仅返回 Monster[]

## Conventions

- TypeScript strict, Tailwind in JSX, Chinese UI
- Monster keyed by `id`, searched by `localized.zh.name`. Base name = before `（`
- **所有搜索框支持拼音首字母**: MoveSearch, MonsterSearch, Pokedex, FeaturedTeams, 借用⊕弹窗, 敌方系别展开
- 拼音匹配: `startsWith(query)` + `includes(query)` (在 `matchPinyinInitials` 里)
- Traits are inherent (no manual override). 咕噜球/血脉 manually selectable
- Trait labels: ⟳ green = cross-switch cumulative, amber = cleared on switch
- 34 leaders auto-matched via `leader_form_id`. 进化之力 → auto-transform
- 天分等级: 3项含性格加成 → "了不起", otherwise "相当好"
- `getPopularPersonality()` / `getPopularTalent()` 沿进化链 + 首领反查 (global effect)
- Release: `E:\洛克王国相关\release\RocoSandbox_Setup.exe`
- Column heights: 210px in battler panels. Page heights: max-h-[70vh]
- 核对条自动确认 1.5s, 关键事件强制手动
- DeepSeek AI 是真·多轮对话 (memory across turns), 撤销同步裁历史
