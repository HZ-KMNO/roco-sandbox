<p align="center">
  <img src="public/logo.png" alt="Roco Sandbox logo" width="120" />
</p>

<p align="center">
  <img src="public/sponsor-qr.jpg" alt="Sponsor QR" width="180" /><br/>
  <sub>If this project helps you, feel free to buy me a coffee</sub>
</p>

> 🐱 Follow the developer: [Qianmibu](https://space.bilibili.com/353064098)

# 🏰 Roco Sandbox

> 💬 Battle assistant for **Roco Kingdom: World** PVP — turn-by-turn AI coach, damage reverse engineering, and a sandbox for what-if analysis.

[![License: Educational](https://img.shields.io/badge/license-educational-blue.svg)](#-license)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB.svg)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6.svg)](https://www.typescriptlang.org/)

🌐 [Simplified Chinese](./README_ZH.md) | English

---

## 🎯 What is this?

💡 A desktop companion that sits alongside your PVP match. Where the in-game UI shows you HP and damage numbers, **Roco Sandbox shows you what those numbers actually mean** — what your opponent's stats probably are, who wins the next 3 turns, what the AI coach would suggest, and where the simulator might be wrong.

💡 It's built on the **PVP Introduction** tactical framework: every recommendation is grounded in *check / counter relationships*, not just damage numbers.

## ✨ Core Features

### 🤖 Multi-turn AI coach (DeepSeek)
- ✅ True conversation memory across turns — the AI remembers what it suggested in R2 when reasoning about R3
- ✅ Pre-loads full team context once (cached system prompt) → cheap per-turn calls
- ✅ Undo a turn, AI history is sliced to match — no hallucinations from rolled-back data
- ✅ Session persisted to localStorage; survives app restart

### 🎯 1.5s Confirmation Bar
💡 After every turn, a slim bar appears at the bottom for 1.5 seconds:
- ✅ **Auto-confirms** for normal turns — no friction
- ✅ **Forces manual confirmation** on key events (KO / Evolution / Mark layer change / Freeze)
- ✅ **Press E** to expand a quick correction panel — fix enemy HP%, your HP, observed damage, both energies
- ✅ The AI is delayed during the bar — only fires after your data is locked in

### 🧠 Damage Reverse Engine
💡 The killer feature. Tell it the actual damage dealt, and it back-solves the formula:

```
damage = floor(round(atk × power × stab × typeEff × 37/41) / def)
       └─→ atk ≈ damage × def / (power × stab × typeEff × 37/41)
```

💡 Each observation narrows an attack range. After 3-5 corrections, the engine identifies the enemy's likely **personality name** (e.g. *Stubborn*) and pins the attacker stat to within ±10. Future damage predictions then use the inferred range, not the default popular build.

💡 The estimate shows up as a purple badge on the enemy panel:
> 💬 `Physical Attack approx. 195 · Stubborn / Magic Attack approx. 210 · Focused (5 observations)`

### ⏪ Turn Timeline + Cascade Replay
💡 Every turn is recorded (state-before, state-after, both actions). The timeline is a horizontal strip at the bottom:
- ✅ Click any past turn → choose **"only this one"** (override that turn's display) or **"replay to current"** (re-simulate every turn after using the corrected state)
- ✅ Replay uses the stored action sequence, so your past decisions are preserved
- ✅ The AI gets an `[Post-turn correction] R3 data corrected: enemy actual HP is 60%, not 50%` message so it knows the context shifted

### 📥 Formula Import
💡 Paste the official Roco Kingdom share format — the kind of text players post on Bilibili:

```
### Balanced Handsome Puppet
# Magic: Evolution Power
#
# Captain Seal: Martial bloodline, {Sever, Bridge Listen, Strength Boost, Water Blade}
# Handsome Puppet: Dark bloodline, {Borrow, Borrow, Borrow, Greed}
# Dust-Eating Fluff: Wing bloodline, {Store, Ground Spike, Pour, Burrow}
# Chess Queen: Leader bloodline, {Shadow Strike, Sand Trap, First Strike, Bridge Listen}
# Needleleaf Ranger: Wing bloodline, {Ground Spike, Thorn Vine, Intercepting Fist, Photosynthesis}
# Papaska: Water bloodline, {Steel Torrent, Bearing Support, Pour, Windrise}
```

💡 → One click creates a new team with all 6 monsters, their bloodlines, skills, recommended personality + talent (auto-resolved through evolution chains and leader form lookups), and the magic item.

> ⚠️ **Note**: Personality and talent imported via the official formula use recommended builds. If they differ from your actual configuration, please adjust manually.

### 🔍 Pinyin Search Everywhere
💡 Type the first letter(s) of each Chinese character:
- ✅ `t` -> Tingqiao, Hidden Clause (any skill whose romanized name starts with t)
- ✅ `tq` -> Tingqiao (initials t + q)
- ✅ `sg` -> Sieve-Tube Rush (first two initials)

💡 Works in all 6 search boxes: skills, monsters, pokedex, featured teams, borrow ⊕ popup, enemy bloodline expansion.

### ⚙️ Trait System (~95% coverage)
💡 Five trait handlers cover entry, exit, end-of-turn, counter, and on-attack triggers:
- ✅ ~30 entry effects
- ✅ ~25 attack-time patterns
- ✅ 14 capture ball variants, including Normal Ball, King Ball, Wonderful Ball, Temperature-Control Ball, Photosynthesis Ball, Net Ball, Insulation Ball, Sand-Wash Ball, Shapeshift Ball, Dark Star Ball, Aggressive Ball, Light-Catching Ball, and Prism Ball.
- ✅ 18 beast bloodline variants across grass, fire, water, light, electric, earth, ice, poison, bug, martial, dragon, wing, cute, ghost, dark, mechanical, illusion, and normal types.
- ✅ Persistent trait fields across switches, such as battery entry count and magic points; other fields are cleared and recalculated on re-entry.

### 🎨 Six Tabs

| Tab | What it does |
|-----|------|
| **Battle** | Live match flow — team panel, enemy panel, suggestion engine, 3-column matchup analysis (skills / magic / switch) |
| **Replay** | Paste battle log → parsed into structured turns → AI replay analysis. Up to 50 saved replays |
| **Teams** | Featured teams (cached + online), formula import, save templates |
| **Pokedex** | All 525 monsters by dex number, with Bilibili recommended config (personality / talent / 4-skill set) |
| **Tutorial** | Reader-style — left TOC + center text. PVP textbook with terms table, three-line tables, prose layout |
| **Settings** | DeepSeek API key, suggestion mode (AI / rule engine), rank mode (master+ / sub-master), theme, font size, data management |

## 🛠 Tech Stack

| Layer | Tech |
|-------|------|
| Desktop shell | **Tauri 2** (Rust) |
| Frontend | **React 19** + **TypeScript** (strict) |
| Styling | **Tailwind CSS v4** + `@tailwindcss/typography` |
| Build | **Vite 7** |
| AI | **DeepSeek** (multi-turn chat completions) |
| Data | Monster/move/type data (525 monsters / 501 moves / 18 types) |

💡 The Rust backend is intentionally **pass-through** — all logic lives in TypeScript so it can be tested and iterated quickly.

> 💡 After downloading the installer, if Windows shows "Windows protected your PC" or "Unknown publisher", click **"More info" → "Run anyway"**. We don't have a paid code signing certificate ($200+/year), but the software is a safe open-source project.

## 🚀 Getting Started

### 📌 Prerequisites

- ✅ **Node.js 18+** (we develop on 24)
- ✅ **Rust** (for Tauri builds)
- ✅ **Windows 10/11** (primary target — macOS/Linux should work but untested)

### 🚀 Install & run

```bash
git clone https://github.com/HZ-KMNO/roco-sandbox.git
cd roco-sandbox
npm install
npm run tauri dev    # Full Tauri desktop app with hot reload
# OR
npm run dev          # Frontend-only on http://localhost:1420 (faster iteration, no native APIs)
```

### 📌 Build a Windows release

```bash
npm run tauri build
# → output: %CARGO_TARGET_DIR%/roco-sandbox/release/bundle/
```

### 📌 Configure DeepSeek (optional but recommended)

💡 The app works without AI — a rule-based suggestion engine takes over. To enable AI:

1. ✅ Get a key from [DeepSeek Platform](https://platform.deepseek.com) ([API Docs](https://api-docs.deepseek.com/zh-cn/))
2. ✅ App -> Settings -> AI -> paste key
3. ✅ Add the first enemy → AI auto-preloads team context → AI replies appear after every turn

💡 Cost is ~¥0.001 per turn. A 30-turn match costs about a coin.

## 📖 User Guide

💡 A comprehensive usage guide is available at [`docs/app-guide.md`](./docs/app-guide.md) (Chinese).

💡 Covers:
- ✅ Quick start (3 steps)
- ✅ Full walkthrough of all 6 tabs
- ✅ Advanced features (formula import / pinyin search / correction bar / timeline / reverse engine / AI coach)
- ✅ Keyboard shortcuts
- ✅ FAQ

💡 Also accessible in-app: Tutorial tab -> User Guide (pinned at top).

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
│   ├── Pokedex.tsx                  # Pokedex tab
│   ├── Tutorial.tsx                 # Reader for tutorials
│   └── ReplayAnalysis.tsx           # Replay tab
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

💡 See [`CLAUDE.md`](./CLAUDE.md) for the architecture deep dive.

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

💡 This is a personal project but PRs are welcome:
- ✅ Bug reports for trait edge cases (~5% of traits aren't fully covered)
- ✅ Personality / talent recommendations for monsters not in the popular table
- ✅ Tutorial content corrections
- ✅ New language localizations

## 📜 License

💡 This project is for **educational and personal use only**. Game data (monster names, skill descriptions, sprite designs) belongs to the original IP holder of *Roco Kingdom: World*. Do not redistribute commercially.

> ⚠️ **No piracy. No commercial use.** This software is a free open-source project. If you paid for access to this software, please report the seller and demand a refund.

---

## 🙏 Acknowledgments

- ✅ **[RK Team Builder](https://rkteambuilder.com/dex?types=1)** — team building reference tool
- ✅ **[LCX Wiki](https://wiki.lcx.cab/lk/skill_list.php)** — authoritative monster/move data source
- ✅ **[Roco PVP Assistant](https://rocopvp.tzrain.wiki)** — popular teams data API
- ✅ **Bilibili creator [Zhuoshuai](https://space.bilibili.com/13884095)** — recommended builds for all monsters ([Full Monster Usage Analysis](https://www.bilibili.com/video/BV1Y4SfBCEwz/))
- ✅ **DeepSeek** — affordable multi-turn LLM API
- ✅ **Roco Kingdom: World community** — tactical theory contributors
- ✅ **Bilibili UP [WwlWss](https://space.bilibili.com/1972682)** — [Tactical Theory](https://www.bilibili.com/video/BV12BduBCEmL/) (core tactical framework)

---

⚔️ Have fun — and remember, the best players know when to stop trusting the simulator.
