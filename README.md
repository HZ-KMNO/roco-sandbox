<p align="center">
  <img src="public/logo.png" alt="Roco Sandbox Logo" width="120" />
</p>

<p align="center">
  <img src="public/sponsor-qr.jpg" alt="Sponsor QR" width="180" /><br/>
  <sub>If this project helps you, feel free to buy me a coffee</sub>
</p>

> 🐱 Follow the developer on Bilibili: [迁米不](https://space.bilibili.com/353064098)

# 🏰 Roco Sandbox

> Battle assistant for Roco Kingdom: World PVP — turn-by-turn AI coach, damage reverse engineering, and a sandbox for what-if analysis.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB.svg)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6.svg)](https://www.typescriptlang.org/)

[简体中文](./README_ZH.md) | English

---

## 🎯 What Is This?

A desktop companion that sits alongside your PVP match. While the in-game UI shows HP percentages and damage numbers, **Roco Sandbox tells you what those numbers actually mean**.

- 🧩 Predict opponent personality and talent stats
- 📊 Preview who wins the next few turns
- 🤖 Get AI coaching for every turn
- 🔧 Correct the simulation when it diverges from reality

All recommendations are grounded in **PVP Introduction** tactical principles — analyzing Check/Counter relationships, redundancy tactics, and breakthrough tactics rather than raw damage comparison.

---

## 🤖 Multi-Turn AI Coach

- 🧠 **True conversation memory** — the AI remembers its advice from round 2 when reasoning about round 3
- ⚡ **Preloaded system prompt** — full team context injected once, then lightweight per-turn calls
- ↩️ **Undo sync** — rolling back a turn also trims the AI chat history
- 💾 **Persistent sessions** — stored in localStorage, survives restarts
- 💰 **Low cost** — roughly 0.001 RMB per turn, about one cent for a 30-turn match

---

## 🎯 Confirmation Bar

After every turn, a slim bar appears at the bottom with a 1.5-second progress bar.

- ✅ Normal turns **auto-confirm** — zero friction
- 🔴 **Key events** (KO, evolution, mark layer change, freeze) force manual confirmation
- 📝 Press `E` to expand the correction panel — adjust enemy HP%, your HP, observed damage, and energy
- ⏳ The AI is delayed during the bar — only fires after you've locked in the data

---

## 🧠 Damage Reverse Engine

Tell it the actual damage dealt, and it reverse-solves the damage formula to narrow down the opponent's attack stat and personality.

Each observation shrinks the range. After 3–5 corrections, the engine identifies the enemy's likely **personality name** and pins their attack stat to within ±10. Future damage predictions use the inferred range instead of default popular builds.

The estimate appears as a purple badge on the enemy panel:

> `物攻≈195·偏执 / 魔攻≈210·专注 (5 observations)`

---

## ⏪ Turn Timeline & Cascade Replay

Every turn is recorded — state before, state after, both players' actions — and displayed as a horizontal timeline at the bottom.

- 🔍 Click any past turn to open retrospective correction
- 📌 **"Only this one"** — override that turn's display without affecting later turns
- 🔄 **"Replay to current"** — re-simulate all subsequent turns using the corrected state
- 🤖 The AI receives a correction notice so it knows the context shifted

---

## 📥 Formula Import

Paste the official share format — the kind of text players post on community platforms:

```
### Team Name
# 魔法：进化之力
#
# Pokémon A：Fire Bloodline、{Skill 1、Skill 2、Skill 3、Skill 4}
# Pokémon B：Dark Bloodline、{Skill 1、Skill 2、Skill 3、Skill 4}
...
```

One click creates a team with all 6 Pokémon, their bloodlines, skills, recommended personality and talent (auto-resolved through evolution chains and leader form lookups), plus the magic item.

> ⚠️ Personality and talent values imported via the official formula use recommended builds. Adjust manually if they differ from your actual configuration.

---

## 🔍 Pinyin Search Everywhere

Type the first letter(s) of each Chinese character's pinyin to filter results instantly.

- `t` matches skills where any character starts with *t*
- `tq` matches skills with two characters starting with *t* + *q*
- `dm` matches Pokémon whose name starts with *d* + *m*

All 6 search boxes in the app support this feature.

---

## ⚙️ Trait System

Approximately 95% trait coverage across five handlers plus two supplemental systems.

- 🚪 **Entry traits** — ~30 effects on switch-in
- 🚶 **Exit traits** — cleanup or transfer on switch-out
- 🔄 **End-of-turn traits** — periodic effects like dedication and auto-detach
- 🛡️ **Counter traits** — triggered on successful counter
- ⚔️ **On-attack traits** — ~25 attack-time patterns
- 🏐 **Capture balls** — 14 variants with different stat modifiers
- 🌸 **Beast bloodlines** — 18 type-based effects

Only persistent fields survive switching; all others are cleared and recalculated on re-entry.

---

## 🎨 Six Tabs

- ⚔️ **Battle** — live match flow with team panels, AI engine, and 3-column matchup analysis
- ▶️ **Replay** — paste battle logs, view structured turns, AI replay analysis (up to 50 saved)
- 👥 **Teams** — featured teams browser, formula import, template management
- 📖 **Pokedex** — all 525 monsters by index number with recommended builds
- 🎓 **Tutorial** — reader-style with table of contents, textbook prose, and term tables
- ⚙ **Settings** — API key, suggestion mode, rank mode, theme, font size, data management

---

## 🛠 Tech Stack

- 🖥️ **Desktop shell** — Tauri 2 (Rust)
- ⚛️ **Frontend** — React 19 + TypeScript (strict mode)
- 🎨 **Styling** — Tailwind CSS v4
- 📦 **Build** — Vite 7
- 🤖 **AI** — DeepSeek (multi-turn chat completions)
- 📊 **Data** — 525 monsters, 501 moves, 18 types

The Rust backend is intentionally pass-through — all business logic lives in TypeScript for fast iteration.

> 💡 If Windows shows "Windows protected your PC" or "Unknown publisher" after downloading the installer, click **"More info" → "Run anyway"**. This software is a safe open-source project; we simply don't have a paid code signing certificate.

---

## 🚀 Getting Started

### 📋 Prerequisites

- Node.js 18 or higher
- Rust (for building the desktop app)
- Windows 10 or 11 (macOS/Linux should work but untested)

### 🔧 Install & Run

```bash
git clone https://github.com/HZ-KMNO/roco-sandbox.git
cd roco-sandbox
npm install
npm run tauri dev     # Full desktop app with hot reload
# or
npm run dev           # Frontend only at http://localhost:1420
```

### 📦 Build a Release

```bash
npm run tauri build
# Output: %CARGO_TARGET_DIR%/roco-sandbox/release/bundle/
```

### 🔑 Configure DeepSeek (Optional)

The app works without AI — a rule-based suggestion engine takes over. To enable AI:

1. Get an API key from the DeepSeek Platform
2. Open the app → Settings → paste the key
3. Add the first enemy — AI auto-preloads and starts suggesting after each turn

---

## 📖 User Guide

A comprehensive usage guide is available at `docs/app-guide.md` (in Chinese). It covers all tabs, advanced features, keyboard shortcuts, and FAQ. Also accessible in-app via the Tutorial tab (pinned at the top).

---

## 🏗 Project Structure

```
src/
├── App.tsx                          # Tab shell, settings, AI orchestration
├── components/
│   ├── TeamPanel.tsx                # Your team
│   ├── EnemyPanel.tsx               # Opponent team
│   ├── MatchupAnalysis.tsx          # 3-column battle UI
│   ├── TurnCorrectionBar.tsx        # 1.5s correction bar
│   ├── TurnTimeline.tsx             # Timeline & cascade replay
│   ├── QuickImport.tsx              # Formula import
│   ├── MonsterCard.tsx              # Monster detail card
│   ├── FeaturedTeams.tsx            # Teams tab
│   ├── Pokedex.tsx                  # Pokedex tab
│   ├── Tutorial.tsx                 # Tutorial reader
│   └── ReplayAnalysis.tsx           # Replay tab
└── lib/
    ├── calculator.ts                # Damage formula & stat calc
    ├── battle.ts                    # Matchup analysis
    ├── simulator.ts                 # Turn engine & trait handlers
    ├── aiAdvisor.ts                 # DeepSeek client (multi-turn)
    ├── aiSession.ts                 # Session persistence & truncation
    ├── observations.ts              # Damage observation log
    ├── damageReverser.ts            # Reverse engine
    ├── battleTimeline.ts            # Turn records & cascade replay
    ├── officialFormatParser.ts      # Share-format parser
    ├── popularStats.ts              # Recommended config lookup
    └── pinyinSearch.ts              # Pinyin search
```

See `CLAUDE.md` for an architecture deep dive.

---

## 📐 Data Flow per Turn

```
User selects skills → Space (execute)
  → resolveTurn() → new state
    → TurnRecord recorded
      → Correction bar appears (1.5s)
        ├─ Key event? → red, must confirm
        ├─ Press E → correction panel
        │   └─ Apply → BattleState updated + observation recorded
        └─ Auto or manual confirm
          → getTurnAdvice() with multi-turn history
            → AI reply + localStorage persistence

Undo → state rollback + AI history trim + notice banner
Retrospective fix → Timeline → this-only or cascade replay
```

---

## 🤝 Contributing

This is a personal project, but pull requests are welcome:
- 🐛 Bug fixes for trait edge cases
- 📊 New recommended build data
- 📝 Tutorial content updates
- 🌍 Localization

---

## 📜 License

This project is for educational and personal use only. Game data belongs to the original IP holder of Roco Kingdom: World.

> ⚠️ No piracy. No commercial use. This is a free open-source project. If you paid for access, please report the seller and demand a refund.

---

## 🙏 Acknowledgments

- 🔗 RK Team Builder — team building reference
- 📚 LCX Wiki — monster and move data source
- 🌐 Roco PVP Assistant — popular teams API
- 📺 Zhuo Shuai — recommended builds for all monsters
- 🤖 DeepSeek — affordable multi-turn LLM API
- 👥 Roco Kingdom: World community — tactical theory contributors
- 🎓 WwlWss — tactical theory

---

⚔️ Have fun. The best players know when to stop trusting the simulator.
