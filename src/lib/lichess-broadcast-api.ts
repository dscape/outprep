/**
 * Rate-limited Lichess broadcast API client.
 *
 * Respects Lichess rate limits: max 1 request/second.
 * On 429, backs off for 60 seconds before retrying.
 */

const LICHESS_API = "https://lichess.org/api";

// ─── Response types ─────────────────────────────────────────────────────────

export interface BroadcastTourInfo {
  id: string;
  name: string;
  slug: string;
  info?: {
    format?: string;
    tc?: string;
    fideTC?: string;
    location?: string;
    players?: string;
  };
  createdAt: number;
  url: string;
  tier?: number;
  dates?: number[];
}

export interface BroadcastRoundInfo {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  rated?: boolean;
  finished?: boolean;
  finishedAt?: number;
  startsAt?: number;
  url?: string;
}

export interface BroadcastListingEntry {
  tour: BroadcastTourInfo;
  round: BroadcastRoundInfo;
  roundToLink?: BroadcastRoundInfo;
  group?: string;
}

export interface BroadcastListingPage {
  active: BroadcastListingEntry[];
  upcoming: BroadcastListingEntry[];
  past: BroadcastListingEntry[];
}

export interface BroadcastTournament {
  tour: BroadcastTourInfo;
  rounds: BroadcastRoundInfo[];
  group?: {
    name: string;
    tours: { id: string; name: string; slug: string }[];
  };
}

// ─── API client ─────────────────────────────────────────────────────────────

export class LichessBroadcastApi {
  private lastRequestAt = 0;
  private cooldownUntil = 0;
  public requestCount = 0;

  private async throttle(): Promise<void> {
    const now = Date.now();

    // Respect 429 cooldown
    if (now < this.cooldownUntil) {
      const wait = this.cooldownUntil - now;
      console.log(`[lichess-api] 429 cooldown: waiting ${Math.ceil(wait / 1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
    }

    // Enforce 1 request per second
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < 1000) {
      await new Promise((r) => setTimeout(r, 1000 - elapsed));
    }

    this.lastRequestAt = Date.now();
  }

  private async fetchWithRateLimit(
    url: string,
    accept = "application/json",
  ): Promise<Response> {
    await this.throttle();
    this.requestCount++;

    const res = await fetch(url, {
      headers: { Accept: accept },
    });

    if (res.status === 429) {
      console.warn(`[lichess-api] 429 rate limited on ${url}`);
      this.cooldownUntil = Date.now() + 60_000;
      throw new Error(`Lichess rate limit hit (429). Cooling down for 60s.`);
    }

    if (!res.ok) {
      throw new Error(`Lichess API error: ${res.status} on ${url}`);
    }

    return res;
  }

  /**
   * GET /api/broadcast/top?page=N
   * Returns paginated list of current, upcoming, and past broadcasts.
   */
  async fetchBroadcastListing(page: number): Promise<BroadcastListingPage> {
    const res = await this.fetchWithRateLimit(
      `${LICHESS_API}/broadcast/top?page=${page}`,
    );
    return res.json();
  }

  /**
   * GET /api/broadcast/{broadcastTournamentId}
   * Returns tournament detail with full round list.
   */
  async fetchBroadcastTournament(
    broadcastId: string,
  ): Promise<BroadcastTournament> {
    const res = await this.fetchWithRateLimit(
      `${LICHESS_API}/broadcast/${broadcastId}`,
    );
    return res.json();
  }

  /**
   * GET /api/broadcast/round/{roundId}.pgn
   * Returns PGN text for all games in a round.
   */
  async fetchRoundPgn(roundId: string): Promise<string> {
    const res = await this.fetchWithRateLimit(
      `${LICHESS_API}/broadcast/round/${roundId}.pgn`,
      "application/x-chess-pgn",
    );
    return res.text();
  }
}
