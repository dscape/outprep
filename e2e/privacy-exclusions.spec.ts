import { expect, test } from "@playwright/test";

const fideId = "2225972";
const canonicalPlayer = `jose-luis-segura-ariza-${fideId}`;
const removedGame = `1st-blau-escacs-open-2015-r1-16-2015/segura-ariza-${fideId}-vs-garcia-comendador-32041349`;

test.describe("configured FIDE erasure", () => {
  test("player, aliases, games, and practice APIs return 404", async ({ request }) => {
    for (const path of [
      `/player/${canonicalPlayer}`,
      `/player/segura-ariza-jose-luis`,
      `/player/${fideId}`,
      `/game/${removedGame}`,
      `/api/fide-games/${canonicalPlayer}`,
      `/api/fide-practice/${canonicalPlayer}`,
      `/api/bot-data/${canonicalPlayer}?platform=fide&purpose=play`,
    ]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(404);
    }
  });

  test("search, sitemap, and affected event pages contain no excluded identity", async ({ request }) => {
    const responses = await Promise.all([
      request.get(`/api/players/search?q=${fideId}`),
      request.get("/sitemap/0"),
      request.get("/event/1st-blau-escacs-open-2015"),
      request.get("/event/european-blitz-2017"),
    ]);

    for (const response of responses) {
      expect(response.ok()).toBe(true);
      const body = (await response.text()).toLowerCase();
      expect(body).not.toContain(fideId);
      expect(body).not.toContain("jose luis segura ariza");
      expect(body).not.toContain("segura ariza, jose luis");
    }
  });
});
