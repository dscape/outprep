import { LichessUser, LichessGame } from "./types";

const LICHESS_API = "https://lichess.org/api";

export async function fetchLichessUser(username: string): Promise<LichessUser> {
  const res = await fetch(`${LICHESS_API}/user/${username}`, {
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) throw new Error(`Player "${username}" not found on Lichess`);
  if (res.status === 429) throw new Error("Rate limited by Lichess. Please try again in a minute.");
  if (!res.ok) throw new Error(`Lichess API error: ${res.status}`);
  return res.json();
}

export async function fetchLichessGames(
  username: string,
  max = 200
): Promise<LichessGame[]> {
  const params = new URLSearchParams({
    max: String(max),
    rated: "true",
    pgnInJson: "true",
    clocks: "true",
    evals: "true",
    opening: "true",
  });

  const res = await fetch(
    `${LICHESS_API}/games/user/${username}?${params}`,
    {
      headers: { Accept: "application/x-ndjson" },
    }
  );

  if (res.status === 404) throw new Error(`Player "${username}" not found on Lichess`);
  if (res.status === 429) throw new Error("Rate limited by Lichess. Please try again in a minute.");
  if (!res.ok) throw new Error(`Lichess API error: ${res.status}`);

  const text = await res.text();
  const lines = text.trim().split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}
