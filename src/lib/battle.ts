import type { Monster, Move, TypeInfo } from "./types";
import { calcDamage, getTypeEffectiveness } from "./calculator";
import type { Stats } from "./calculator";
import typesData from "../data/types.json";

const types = typesData as TypeInfo[];

function getTypeInfo(typeName: string): TypeInfo | undefined {
  return types.find((t) => t.name === typeName);
}

export interface MoveAnalysis {
  move: Move;
  damage: { min: number; max: number };
  effectiveness: number;
  hpPercent: { min: number; max: number };
  isStab: boolean;
  category: string;
}

export function analyzeMoves(
  attacker: Monster,
  defender: Monster,
  attackerStats: Stats,
  defenderStats: Stats,
  moves: Move[]
): MoveAnalysis[] {
  const defenderTypeInfos: TypeInfo[] = [];
  const mainType = getTypeInfo(defender.main_type.name);
  if (mainType) defenderTypeInfos.push(mainType);
  if (defender.sub_type) {
    const subType = getTypeInfo(defender.sub_type.name);
    if (subType) defenderTypeInfos.push(subType);
  }

  return moves
    .map((move) => {
      const moveTypeName = move.move_type?.name || "";
      const isStab =
        moveTypeName === attacker.main_type.name ||
        moveTypeName === attacker.sub_type?.name;

      if (!move.power) {
        return {
          move,
          damage: { min: 0, max: 0 },
          effectiveness: 1,
          hpPercent: { min: 0, max: 0 },
          isStab,
          category: move.move_category,
        };
      }

      const effectiveness = getTypeEffectiveness(moveTypeName, defenderTypeInfos);

      const isPhysical = move.move_category === "Physical Attack";
      const atk = isPhysical ? attackerStats.phyAtk : attackerStats.magAtk;
      const def = isPhysical ? defenderStats.phyDef : defenderStats.magDef;

      const result = calcDamage(atk, def, move.power, effectiveness, isStab);

      return {
        move,
        damage: { min: result.min, max: result.max },
        effectiveness,
        hpPercent: {
          min: Math.round((result.min / defenderStats.hp) * 100),
          max: Math.round((result.max / defenderStats.hp) * 100),
        },
        isStab,
        category: move.move_category,
      };
    })
    .sort((a, b) => b.damage.max - a.damage.max);
}

export interface MatchupResult {
  aChecksB: boolean;
  aCountersB: boolean;
  bChecksA: boolean;
  bCountersA: boolean;
  aBestMove: MoveAnalysis | null;
  bBestMove: MoveAnalysis | null;
  aKoTurns: number;
  bKoTurns: number;
  speedWinner: "a" | "b" | "tie";
  pressure: "a→b" | "b→a" | "mutual" | "stalemate";
}

function calcKoTurns(bestDamage: number, defenderHp: number, moveCost: number): number {
  if (bestDamage <= 0) return Infinity;
  const rawTurns = Math.ceil(defenderHp / bestDamage);
  const totalEnergyCost = rawTurns * moveCost;
  const focusTurns = Math.max(0, Math.ceil((totalEnergyCost - 10) / 5));
  return rawTurns + focusTurns;
}

function getBestAffordableMove(analyses: MoveAnalysis[]): MoveAnalysis | null {
  const affordable = analyses.filter((a) => a.move.energy_cost <= 10);
  return affordable[0] || null;
}

export function analyzeMatchup(
  monsterA: Monster,
  monsterB: Monster,
  statsA: Stats,
  statsB: Stats,
  movesA: Move[],
  movesB: Move[]
): MatchupResult {
  const aVsB = analyzeMoves(monsterA, monsterB, statsA, statsB, movesA);
  const bVsA = analyzeMoves(monsterB, monsterA, statsB, statsA, movesB);

  const aBest = getBestAffordableMove(aVsB);
  const bBest = getBestAffordableMove(bVsA);

  const aBestDmg = aBest ? aBest.damage.max : 0;
  const bBestDmg = bBest ? bBest.damage.max : 0;
  const aBestCost = aBest ? aBest.move.energy_cost : 0;
  const bBestCost = bBest ? bBest.move.energy_cost : 0;

  const speedWinner: "a" | "b" | "tie" =
    statsA.spd > statsB.spd ? "a" : statsA.spd < statsB.spd ? "b" : "tie";

  const aKoTurns = calcKoTurns(aBestDmg, statsB.hp, aBestCost);
  const bKoTurns = calcKoTurns(bBestDmg, statsA.hp, bBestCost);

  const aChecksB = (() => {
    if (aBestDmg <= 0) return false;
    if (speedWinner === "a" || speedWinner === "tie") {
      return aKoTurns <= bKoTurns;
    }
    const dmgTaken = bBestDmg * aKoTurns;
    return dmgTaken < statsA.hp;
  })();

  const bChecksA = (() => {
    if (bBestDmg <= 0) return false;
    if (speedWinner === "b" || speedWinner === "tie") {
      return bKoTurns <= aKoTurns;
    }
    const dmgTaken = aBestDmg * bKoTurns;
    return dmgTaken < statsB.hp;
  })();

  const aCountersB = (() => {
    if (aBestDmg <= 0) return false;
    const hitsBeforeActs = speedWinner === "b" ? 2 : 1;
    const dmgBeforeFirstAttack = bBestDmg * hitsBeforeActs;
    if (dmgBeforeFirstAttack >= statsA.hp) return false;
    const remainingHp = statsA.hp - dmgBeforeFirstAttack;
    const turnsToKo = Math.ceil(statsB.hp / aBestDmg);
    const additionalHits = speedWinner === "b" ? turnsToKo : Math.max(0, turnsToKo - 1);
    const totalDmgAfter = bBestDmg * additionalHits;
    return totalDmgAfter < remainingHp;
  })();

  const bCountersA = (() => {
    if (bBestDmg <= 0) return false;
    const hitsBeforeActs = speedWinner === "a" ? 2 : 1;
    const dmgBeforeFirstAttack = aBestDmg * hitsBeforeActs;
    if (dmgBeforeFirstAttack >= statsB.hp) return false;
    const remainingHp = statsB.hp - dmgBeforeFirstAttack;
    const turnsToKo = Math.ceil(statsA.hp / bBestDmg);
    const additionalHits = speedWinner === "a" ? turnsToKo : Math.max(0, turnsToKo - 1);
    const totalDmgAfter = aBestDmg * additionalHits;
    return totalDmgAfter < remainingHp;
  })();

  let pressure: MatchupResult["pressure"];
  if (aChecksB && bChecksA) pressure = "mutual";
  else if (aChecksB || aCountersB) pressure = "a→b";
  else if (bChecksA || bCountersA) pressure = "b→a";
  else pressure = "stalemate";

  return {
    aChecksB, aCountersB, bChecksA, bCountersA,
    aBestMove: aBest, bBestMove: bBest,
    aKoTurns, bKoTurns, speedWinner, pressure,
  };
}
