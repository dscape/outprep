import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

describe("edge FIDE exclusion guard", () => {
  it.each([
    "/player/removed-2225972",
    "/game/event/removed-2225972-vs-player-1",
    "/api/fide-games/removed-2225972",
    "/api/bot-data/removed-2225972?platform=fide",
  ])("returns a non-cacheable 404 for %s", (path) => {
    const response = proxy(new NextRequest(`http://localhost${path}`));

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toContain("noarchive");
  });
});
