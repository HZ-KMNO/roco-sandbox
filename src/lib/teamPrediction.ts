import type { Monster } from "./types";
import monstersDetail from "../data/monsters_detail.json";
import popularTeamsData from "../data/popular_teams.json";

const detailMap = new Map((monstersDetail as Monster[]).map((m) => [m.id, m]));

interface TeamItem {
  snapshot: {
    builds: Array<{ creatureId: string }>;
  };
}

interface PopularTeamsJson {
  items: TeamItem[];
}

interface TeammateScore {
  monster: Monster;
  score: number;
}

// Build co-occurrence map at module init
function buildCooccurrence(): Map<number, Map<number, number>> {
  const cooc = new Map<number, Map<number, number>>();

  for (const item of (popularTeamsData as unknown as PopularTeamsJson).items) {
    const builds = item.snapshot.builds;
    const ids = builds.map((b) => parseInt(b.creatureId)).filter((id) => !isNaN(id));

    for (const id of ids) {
      if (!cooc.has(id)) cooc.set(id, new Map());
      const teammateMap = cooc.get(id)!;
      for (const otherId of ids) {
        if (otherId === id) continue;
        teammateMap.set(otherId, (teammateMap.get(otherId) || 0) + 1);
      }
    }
  }

  return cooc;
}

const cooccurrence = buildCooccurrence();

function getBaseName(name: string): string {
  const idx = name.indexOf("（");
  return idx === -1 ? name : name.slice(0, idx);
}

export function predictTeammates(currentIds: number[], excludeBaseNames: string[] = []): TeammateScore[] {
  if (currentIds.length === 0) return [];

  const scores = new Map<number, number>();
  const excludeSet = new Set(currentIds);
  const baseNameSet = new Set(excludeBaseNames);

  for (const id of currentIds) {
    const teammates = cooccurrence.get(id);
    if (!teammates) continue;
    for (const [tid, count] of teammates) {
      if (excludeSet.has(tid)) continue;
      scores.set(tid, (scores.get(tid) || 0) + count);
    }
  }

  const result: TeammateScore[] = [];
  for (const [id, score] of scores) {
    const monster = detailMap.get(id);
    if (!monster) continue;
    if (baseNameSet.has(getBaseName(monster.localized.zh.name))) continue;
    result.push({ monster, score });
  }

  result.sort((a, b) => b.score - a.score);
  return result.slice(0, 6);
}
