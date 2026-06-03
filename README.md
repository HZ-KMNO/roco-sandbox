<p align="center">
  <img src="./public/logo.png" alt="洛克沙盘 Logo" width="120" />
</p>

<p align="center">
  <img src="./public/sponsor-qr.jpg" alt="Sponsor QR" width="180" /><br/>
  <sub>If this project helps you, feel free to buy me a coffee</sub>
</p>

# 🏰 Roco Sandbox · 洛克沙盘

> Battle assistant for **Roco Kingdom: World** PVP — turn-by-turn AI coach, damage reverse engineering, and a sandbox for what-if analysis.

[![License: Educational](https://img.shields.io/badge/license-educational-blue.svg)](#-license)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB.svg)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6.svg)](https://www.typescriptlang.org/)

[简体中文](./README_ZH.md) | English

---

## 🎯 What is this?

A desktop companion that sits alongside your PVP match. Where the in-game UI shows you HP and damage numbers, **Roco Sandbox shows you what those numbers actually mean** — what your opponent's stats probably are, who wins the next 3 turns, what the AI coach would suggest, and where the simulator might be wrong.

It's built on the **WSS (Win-Stable-Strategy) tactical framework**: every recommendation is grounded in *check / counter relationships*, not just damage numbers.

## ✨ Core Features

### 🤖 Multi-turn AI coach (DeepSeek)
- True conversation memory across turns — the AI remembers what it suggested in R2 when reasoning about R3
- Pre-loads full team context once (cached system prompt) → cheap per-turn calls
- Undo a turn, AI history is sliced to match — no hallucinations from rolled-back data
- Session persisted to localStorage; survives app restart

### 🎯 1.5s Confirmation Bar
After every turn, a slim bar appears at the bottom for 1.5 seconds:
- **Auto-confirms** for normal turns — no friction
- **Forces manual confirmation** on key events (KO / Evolution / Mark layer change / Freeze)
- **Press E** to expand a quick correction panel — fix enemy HP%, your HP, observed damage, both energies
- The AI is delayed during the bar — only fires after your data is locked in

### 🧠 Damage Reverse Engine
The killer feature. Tell it the actual damage dealt, and it back-solves the formula:

```
damage = floor(round(atk × power × stab × typeEff × 37/41) / def)
       └─→ atk ≈ damage × def / (power × stab × typeEff × 37/41)
```

Each observation narrows an attack range. After 3-5 corrections, the engine identifies the enemy's likely **personality name** (e.g. *偏执 Stubborn*) and pins the attacker stat to within ±10. Future damage predictions then use the inferred range, not the default popular build.

The estimate shows up as a purple badge on the enemy panel:
> `物攻≈195·偏执 / 魔攻≈210·专注（5次）`

### ⏪ Turn Timeline + Cascade Replay
Every turn is recorded (state-before, state-after, both actions). The timeline is a horizontal strip at the bottom:
- Click any past turn → choose **"only this one"** (override that turn's display) or **"replay to current"** (re-simulate every turn after using the corrected state)
- Replay uses the stored action sequence, so your past decisions are preserved
- The AI gets an `[事后修正] R3 数据已修正：敌方实际HP 60% 而非 50%` message so it knows the context shifted

### 📥 Formula Import
Paste the official Roco Kingdom share format — the kind of text players post on Bilibili:

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

→ One click creates a new team with all 6 monsters, their bloodlines, skills, recommended personality + talent (auto-resolved through evolution chains and leader form lookups), and the magic item.

> ⚠️ **Note**: Personality and talent imported via the official formula use recommended builds. If they differ from your actual configuration, please adjust manually.

### 🔍 Pinyin Search Everywhere
Type the first letter(s) of each Chinese character:
- `t` → 听桥, 隐藏条款 (any skill where one of the characters starts with t)
- `tq` → 听桥 (where the characters' initials are *t* + *q*)
- `sg` → 筛管奔流 (sgbl — first two characters)

Works in all 6 search boxes: skills, monsters, pokedex, featured teams, borrow ⊕ popup, enemy bloodline expansion.

### ⚙️ Trait System (~95% coverage)
Five trait handlers cover entry, exit, end-of-turn, counter, and on-attack triggers:
- ~30 entry effects
- ~25 attack-time patterns
- 14 capture ball variants (普通球, 国王球, 美妙球, 调温球, 光合球, 网兜球, 绝缘球, 淘沙球, 变幻球, 暗星球, 好战球, 捕光球, 棱镜球…)
- 18 beast bloodline variants (草/火/水/光/电/地/冰/毒/虫/武/龙/翼/萌/幽/恶/机械/幻/普通)
- Persistent trait fields across switches (蓄电池 entryCount, 魔力值 magicPoints) — others are cleared and recalculated on re-entry

### 🎨 Six Tabs

| Tab | What it does |
|-----|------|
| **对战 Battle** | Live match flow — team panel, enemy panel, suggestion engine, 3-column matchup analysis (skills / magic / switch) |
| **复盘 Replay** | Paste battle log → parsed into structured turns → AI replay analysis. Up to 50 saved replays |
| **配队 Teams** | Featured teams (cached + online), formula import, save templates |
| **图鉴 Pokedex** | All 525 monsters by dex number, with B-station recommended config (personality / talent / 4-skill set) |
| **教程 Tutorial** | Reader-style — left TOC + center text. PVP textbook with terms table, three-line tables, prose layout |
| **设置 Settings** | DeepSeek API key, suggestion mode (AI / rule engine), rank mode (master+ / sub-master), theme, font size, data management |

## 🛠 Tech Stack

| Layer | Tech |
|-------|------|
| Desktop shell | **Tauri 2** (Rust) |
| Frontend | **React 19** + **TypeScript** (strict) |
| Styling | **Tailwind CSS v4** + `@tailwindcss/typography` |
| Build | **Vite 7** |
| AI | **DeepSeek** (multi-turn chat completions) |
| Data | Monster/move/type data (525 monsters / 501 moves / 18 types) |

The Rust backend is intentionally **pass-through** — all logic lives in TypeScript so it can be tested and iterated quickly.

## 🚀 Getting Started

### Prerequisites

- **Node.js 18+** (we develop on 24)
- **Rust** (for Tauri builds)
- **Windows 10/11** (primary target — macOS/Linux should work but untested)

### Install & run

```bash
git clone https://github.com/HZ-KMNO/roco-sandbox.git
cd roco-sandbox
npm install
npm run tauri dev    # Full Tauri desktop app with hot reload
# OR
npm run dev          # Frontend-only on http://localhost:1420 (faster iteration, no native APIs)
```

### Build a Windows release

```bash
npm run tauri build
# → output: %CARGO_TARGET_DIR%/roco-sandbox/release/bundle/
```

### Configure DeepSeek (optional but recommended)

The app works without AI — a rule-based suggestion engine takes over. To enable AI:

1. Get a key from [platform.deepseek.com](https://platform.deepseek.com)
2. App → 设置 (Settings) → 🤖 AI → paste key
3. Add the first enemy → AI auto-preloads team context → AI replies appear after every turn

Cost is ~¥0.001 per turn. A 30-turn match costs about a coin.

## 📖 User Guide

A comprehensive usage guide is available at [`docs/app-guide.md`](./docs/app-guide.md) (Chinese).

Covers:
- Quick start (3 steps)
- Full walkthrough of all 6 tabs
- Advanced features (formula import / pinyin search / correction bar / timeline / reverse engine / AI coach)
- Keyboard shortcuts
- FAQ

Also accessible in-app: Tutorial Tab → 使用教程 (pinned at top).

---

## 🏗 Project Structure

```
src/
├── App.tsx                          # 6-tab shell, settings, AI orchestration
├── components/
│   ├── TeamPanel.tsx                # My team (multi-team localStorage)
│   ├── EnemyPanel.tsx               # Enemy team
│   ├── MatchupAnalysis.tsx          # 3-column battle UI
│   ├── TurnCorrectionBar.tsx        # 1.5s correction bar
│   ├── TurnTimeline.tsx             # Bottom timeline + cascade replay UI
│   ├── QuickImport.tsx              # Formula import
│   ├── FeaturedTeams.tsx            # Teams tab
│   ├── Pokedex.tsx                  # 图鉴 tab
│   ├── Tutorial.tsx                 # Reader for tutorials
│   └── ReplayAnalysis.tsx           # 复盘 tab
└── lib/
    ├── calculator.ts                # Damage formula + stat calc
    ├── battle.ts                    # Matchup analysis (check/counter/KO turns)
    ├── simulator.ts                 # Full turn-based engine + 5 trait handlers
    ├── aiAdvisor.ts                 # DeepSeek client (multi-turn)
    ├── aiSession.ts                 # Session persistence + truncation
    ├── observations.ts              # Damage observation log
    ├── damageReverser.ts            # Reverse-solve attacker stats + personality
    ├── battleTimeline.ts            # Turn records + cascade replay
    ├── officialFormatParser.ts      # Shared share-format parser
    ├── popularStats.ts              # Recommended config (with chain/leader fallback)
    └── pinyinSearch.ts              # Initial-letter Chinese search
```

See [`CLAUDE.md`](./CLAUDE.md) for the architecture deep dive.

## 📐 Data Flow per Turn

```
User selects skills → Space (execute)
  └→ resolveTurn(state, myAction, enemyAction) → newState
     └→ TurnRecord pushed to timeline
        └→ TurnCorrectionBar shows (1.5s progress bar)
           ├─ Key event? → Red, must press Enter
           └─ User presses E → Correction panel
                ├─ Adjust HP% / damage / energy
                └─ Apply → BattleState updated + recordObservation()
        └→ Auto/manual confirm → onTurnExecuted
           └→ getTurnAdvice(snap, {turnId})
              └→ DeepSeek with full multi-turn history
                 └→ AI bubble + localStorage persist
```

## 🤝 Contributing

This is a personal project but PRs are welcome:
- Bug reports for trait edge cases (~5% of traits aren't fully covered)
- Personality / talent recommendations for monsters not in the popular table
- Tutorial content corrections
- New language localizations

## 📜 License

This project is for **educational and personal use only**. Game data (monster names, skill descriptions, sprite designs) belongs to the original IP holder of *Roco Kingdom: World*. Do not redistribute commercially.

---

## 🙏 Acknowledgments

- **[RK Team Builder](https://rkteambuilder.com/dex?types=1)** — team building reference tool
- **[LCX Wiki](https://wiki.lcx.cab/lk/skill_list.php)** — authoritative monster/move data source
- **[Roco PVP Assistant](https://rocopvp.tzrain.wiki)** — popular teams data API
- **Bilibili UP [卓帅丶](https://space.bilibili.com/13884095)** — recommended builds for all monsters ([全精灵用法分析](https://www.bilibili.com/video/BV1Y4SfBCEwz/))
- **DeepSeek** — affordable multi-turn LLM API
- **Roco Kingdom: World community** — tactical theory contributors
- **[WSS Tactical Theory](https://www.bilibili.com/video/BV12BduBCEmL/)** — core tactical framework

---

⚔️ Have fun — and remember, the best players know when to stop trusting the simulator.
