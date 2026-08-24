import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLichessGames } from "./lichess";

describe("fetchLichessGames", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("allows for Lichess's throttled export rate", async () => {
    const timeoutSignal = new AbortController().signal;
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeoutSignal);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(`${JSON.stringify({ id: "game-1", moves: "e4 e5" })}\n`),
    );
    vi.stubGlobal("fetch", fetchMock);

    const games = await fetchLichessGames("slow-player", 2000);

    expect(timeout).toHaveBeenCalledWith(115_000);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/games/user/slow-player?max=2000"),
      expect.objectContaining({ signal: timeoutSignal }),
    );
    expect(games).toHaveLength(1);
  });

  it("uses complete games received before an export timeout", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const read = vi
      .fn()
      .mockResolvedValueOnce({
        done: false,
        value: new TextEncoder().encode(
          `${JSON.stringify({ id: "game-1", moves: "d4 d5" })}\n`,
        ),
      })
      .mockImplementationOnce(async () => {
        controller.abort();
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      });
    const releaseLock = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      body: { getReader: () => ({ read, releaseLock }) },
    }));

    const games = await fetchLichessGames("slow-player", 2000);

    expect(games).toMatchObject([{ id: "game-1", moves: "d4 d5" }]);
    expect(releaseLock).toHaveBeenCalledOnce();
  });
});
