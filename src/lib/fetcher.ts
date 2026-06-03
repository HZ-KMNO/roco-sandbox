import { invoke } from "@tauri-apps/api/core";

const API_URL = "https://rocopvp.tzrain.wiki/api/popular/teams";

/** Returns cached teams JSON, or null if no cache exists or not in Tauri. */
export async function getCachedTeams(): Promise<string | null> {
  try {
    const text = await invoke<string | null>("get_cached_teams");
    return text ?? null;
  } catch {
    return null;
  }
}

/** Fetches latest popular teams from tzrain, caches locally, returns JSON. */
export async function fetchPopularTeams(): Promise<string> {
  try {
    return await invoke<string>("fetch_popular_teams");
  } catch {
    // Fallback: try direct fetch (works in Tauri webview, may fail in browser)
    const resp = await fetch(API_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.text();
  }
}
