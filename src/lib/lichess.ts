import { LichessUser, LichessGame } from "./types";

const LICHESS_API = "https://lichess.org/api";

const LICHESS_HEADERS = {
  "User-Agent": "outprep.xyz (https://outprep.xyz)",
};

const LICHESS_EXPORT_GAMES_PER_SECOND = 20;
const LICHESS_EXPORT_TIMEOUT_BUFFER_MS = 15_000;
const MAX_LICHESS_EXPORT_TIMEOUT_MS = 120_000;

export async function fetchLichessUser(username: string): Promise<LichessUser> {
  const res = await fetch(`${LICHESS_API}/user/${username}`, {
    headers: { ...LICHESS_HEADERS, Accept: "application/json" },
  });
  if (res.status === 404) throw new Error(`Player "${username}" not found on Lichess`);
  if (res.status === 429) throw new Error("Rate limited by Lichess. Please try again in a minute.");
  if (!res.ok) throw new Error(`Lichess API error: ${res.status}`);
  return res.json();
}

export async function fetchLichessGames(
  username: string,
  max = 2000,
  since?: number,
): Promise<LichessGame[]> {
  const params = new URLSearchParams({
    max: String(max),
    rated: "true",
    pgnInJson: "true",
    clocks: "true",
    evals: "true",
    opening: "true",
  });

  if (since) {
    params.set("since", String(since));
  }

  const signal = AbortSignal.timeout(getExportTimeout(max));
  const res = await fetch(
    `${LICHESS_API}/games/user/${username}?${params}`,
    {
      headers: { ...LICHESS_HEADERS, Accept: "application/x-ndjson" },
      signal,
    }
  );

  if (res.status === 404) throw new Error(`Player "${username}" not found on Lichess`);
  if (res.status === 429) throw new Error("Rate limited by Lichess. Please try again in a minute.");
  if (!res.ok) throw new Error(`Lichess API error: ${res.status}`);

  const games = await readGames(res, signal, username);
  // Filter out games with no moves (noStart, aborted before any move, etc.)
  return games.filter((g) => g.moves && g.moves.trim().length > 0);
}

async function readGames(
  response: Response,
  signal: AbortSignal,
  username: string,
): Promise<LichessGame[]> {
  if (!response.body) return [];

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const games: LichessGame[] = [];
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) games.push(JSON.parse(line));
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) games.push(JSON.parse(buffer));
  } catch (error) {
    if (!signal.aborted || games.length === 0) throw error;
    console.warn(
      `[lichess] Export timed out for ${username}; using ${games.length} downloaded games`,
    );
  } finally {
    reader.releaseLock();
  }

  return games;
}

function getExportTimeout(max: number): number {
  // Anonymous Lichess exports are throttled to about 20 games per second.
  // Allow enough time for the requested game count plus network overhead.
  const exportDuration = Math.ceil(max / LICHESS_EXPORT_GAMES_PER_SECOND) * 1_000;
  return Math.min(
    Math.max(exportDuration + LICHESS_EXPORT_TIMEOUT_BUFFER_MS, 20_000),
    MAX_LICHESS_EXPORT_TIMEOUT_MS,
  );
}
