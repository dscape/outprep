/**
 * Session bootstrap — player discovery, download, and session naming.
 *
 * Handles the bootstrapping of player data when agents start in autonomous
 * mode with no pre-selected players. Discovers players via web search
 * and Lichess API, downloads game data, and builds session names.
 *
 * Extracted from agent-manager.ts to isolate bootstrap/discovery concerns.
 */

/**
 * Build a semantic session name from players, focus, and ELO range.
 * e.g. "accuracy-elo1500-1800-alice+bob", "opening+endgame-elo2200-DrNykterstein"
 */
export function buildSessionName(
  players: string[],
  focus: string,
  state: { sessions: { name: string }[] },
  playerElos?: Map<string, number>,
): string {
  const focusPart = focus.replace(/,/g, "+");
  let base: string;

  if (players.length === 0) {
    base = `research-${focusPart}`;
  } else {
    const elos = players
      .map((p) => playerElos?.get(p))
      .filter((e): e is number => e != null)
      .sort((a, b) => a - b);
    const eloPart =
      elos.length > 0
        ? elos.length === 1
          ? `${elos[0]}`
          : `${elos[0]}-${elos[elos.length - 1]}`
        : "unk";
    const playerPart =
      players.length <= 2
        ? players.join("+")
        : `${players[0]}+${players.length - 1}more`;
    base = `${focusPart}-elo${eloPart}-${playerPart}`;
  }

  // Deduplicate: append -v2, -v3, etc. if name already exists
  const existingNames = new Set(state.sessions.map((s) => s.name));
  if (!existingNames.has(base)) return base;
  for (let v = 2; ; v++) {
    const candidate = `${base}-v${v}`;
    if (!existingNames.has(candidate)) return candidate;
  }
}

/**
 * Download and validate player data for a list of usernames.
 * Returns only usernames that have valid game data.
 */
export async function downloadPlayers(usernames: string[]): Promise<string[]> {
  const { fetchPlayer, getGames } = await import("../data/game-store");

  console.log(`  Downloading data for ${usernames.length} player(s)...\n`);
  const validPlayers: string[] = [];
  for (const username of usernames) {
    try {
      console.log(`  [${username}] Fetching...`);
      const data = await fetchPlayer(username);
      const games = getGames(username);
      if (games.length === 0) {
        console.log(`  [${username}] ✗ 0 games found, skipping.`);
      } else {
        console.log(`  [${username}] ✓ ${games.length} games (Elo: ${data.estimatedElo})`);
        validPlayers.push(username);
      }
    } catch (err) {
      console.error(`  [${username}] ✗ Failed: ${err}`);
    }
  }
  return validPlayers;
}

/**
 * Bootstrap player data when none exists.
 * Searches the web for Lichess usernames + hits the Lichess leaderboard API,
 * then fetches player profiles/games. Logs steps as tool_jobs for dashboard.
 */
export async function bootstrapPlayers(agentId: string): Promise<string[]> {
  const { createWebTools } = await import("../tools/web-tools");
  const { fetchPlayer, getGames } = await import("../data/game-store");
  const { getForgeDb } = await import("../state/forge-db");
  const { randomUUID } = await import("node:crypto");

  const webTools = createWebTools();
  const db = getForgeDb();

  function logJob(toolName: string, input: unknown): string {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO tool_jobs (id, session_id, agent_id, tool_name, status, input, created_at, blocking, retry_count)
       VALUES (?, 'bootstrap', ?, ?, 'running', ?, ?, 0, 0)`
    ).run(id, agentId, toolName, JSON.stringify(input), new Date().toISOString());
    return id;
  }

  function completeJob(id: string, output: string) {
    db.prepare(
      `UPDATE tool_jobs SET status = 'completed', output = ?, completed_at = ? WHERE id = ?`
    ).run(output.slice(0, 10000), new Date().toISOString(), id);
  }

  function failJob(id: string, error: string) {
    db.prepare(
      `UPDATE tool_jobs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`
    ).run(error, new Date().toISOString(), id);
  }

  // ── Step 1: Discover usernames via web search ──

  const queries = [
    "lichess player 1500 rating profile site:lichess.org/@",
    "lichess 1200 elo player rapid site:lichess.org/@",
    "lichess intermediate player classical games site:lichess.org/@",
  ];

  const discovered = new Map<string, number | null>(); // username → rating hint
  const PROFILE_RE = /lichess\.org\/@\/([A-Za-z0-9_-]{2,20})/g;
  const EXCLUDED = new Set([
    "lichess", "api", "team", "tournament", "swiss", "broadcast", "tv", "forum",
  ]);

  for (const query of queries) {
    const jobId = logJob("bootstrap_search", { query });
    try {
      console.log(`    Searching: "${query}"`);
      const results = await webTools.search(query);
      const found: string[] = [];
      for (const r of results) {
        const text = `${r.url} ${r.snippet} ${r.title}`;
        let match: RegExpExecArray | null;
        PROFILE_RE.lastIndex = 0;
        while ((match = PROFILE_RE.exec(text)) !== null) {
          const name = match[1];
          if (!EXCLUDED.has(name.toLowerCase()) && !discovered.has(name)) {
            discovered.set(name, null);
            found.push(name);
          }
        }
      }
      completeJob(jobId, JSON.stringify({ results: results.length, usernames: found }));
      console.log(`    Found ${found.length} username(s)`);
    } catch (err) {
      failJob(jobId, (err as Error).message);
      console.warn(`    Search failed: ${(err as Error).message}`);
    }
  }

  // ── Step 2: Lichess rating-capped tournaments for diverse Elo ──
  //
  // Fetch players from active rating-capped arenas (≤1500, ≤2000, etc.)
  // instead of the top leaderboard, to get lower-rated players that are
  // more valuable for Maia-style research.

  const jobId2 = logJob("bootstrap_tournament", { source: "lichess arena API" });
  try {
    console.log(`    Fetching Lichess tournaments for diverse-rated players...`);
    const res = await fetch("https://lichess.org/api/tournament", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const data = await res.json() as {
        started?: { id: string; fullName: string; nbPlayers: number }[];
      };
      // Find rating-capped tournaments with enough players
      const capped = (data.started ?? [])
        .filter((t) => /≤\d+/.test(t.fullName) && t.nbPlayers >= 20)
        .sort((a, b) => b.nbPlayers - a.nbPlayers)
        .slice(0, 3);

      let totalFound = 0;
      for (const t of capped) {
        try {
          const tRes = await fetch(
            `https://lichess.org/api/tournament/${t.id}/results?nb=10`,
            { headers: { Accept: "application/x-ndjson" }, signal: AbortSignal.timeout(10_000) },
          );
          if (tRes.ok) {
            const lines = (await tRes.text()).trim().split("\n").filter(Boolean);
            for (const line of lines) {
              const p = JSON.parse(line) as { username: string; rating: number };
              if (p.username && !EXCLUDED.has(p.username.toLowerCase()) && !discovered.has(p.username)) {
                discovered.set(p.username, p.rating);
                totalFound++;
              }
            }
          }
        } catch { /* skip individual tournament failures */ }
      }
      completeJob(jobId2, JSON.stringify({ tournaments: capped.length, players: totalFound }));
      console.log(`    Tournaments: ${totalFound} player(s) from ${capped.length} arena(s)`);
    } else {
      failJob(jobId2, `HTTP ${res.status}`);
    }
  } catch (err) {
    failJob(jobId2, (err as Error).message);
    console.warn(`    Tournament fetch failed: ${(err as Error).message}`);
  }

  if (discovered.size === 0) {
    console.log("    No usernames discovered.");
    return [];
  }

  // ── Step 3: Select diverse candidates, preferring lower-rated players ──
  //
  // Lower-rated players (1200-2000) are more valuable for Maia-style
  // research since Stockfish depth differences matter less and human
  // move patterns are more distinctive.

  const entries = Array.from(discovered.entries());
  // Sort: known ratings first (ascending — lower rated first), unknown last
  entries.sort((a, b) => {
    if (a[1] != null && b[1] != null) return a[1] - b[1];
    if (a[1] != null) return -1;
    if (b[1] != null) return 1;
    return 0;
  });
  const candidates = entries.slice(0, 5).map(([name]) => name);
  console.log(`    Candidates: ${candidates.join(", ")}`);

  const valid: string[] = [];
  for (const username of candidates) {
    const jobId = logJob("bootstrap_fetch_player", { username });
    try {
      console.log(`    Fetching ${username} from Lichess...`);
      const data = await fetchPlayer(username);
      const games = getGames(username);
      if (games.length === 0) {
        failJob(jobId, "0 games found");
        console.log(`    [${username}] 0 games — skipped`);
      } else {
        completeJob(jobId, JSON.stringify({ elo: data.estimatedElo, games: games.length }));
        console.log(`    [${username}] ✓ ${games.length} games (Elo: ${data.estimatedElo})`);
        valid.push(username);
      }
    } catch (err) {
      failJob(jobId, (err as Error).message);
      console.warn(`    [${username}] Failed: ${(err as Error).message}`);
    }
  }

  return valid;
}
