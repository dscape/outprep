import { expect, test } from "@playwright/test";

const phase = {
  totalMoves: 0,
  mistakes: 0,
  blunders: 0,
  avgCPL: 0,
  errorRate: 0,
  blunderRate: 0,
};

const botData = {
  errorProfile: {
    opening: phase,
    middlegame: phase,
    endgame: phase,
    overall: phase,
    gamesAnalyzed: 0,
  },
  whiteTrie: {
    "white-position": {
      totalGames: 2,
      moves: [{ uci: "e2e4", san: "e4", count: 2, winRate: 0.5 }],
    },
  },
  blackTrie: {
    "black-position": {
      totalGames: 2,
      moves: [{ uci: "e7e5", san: "e5", count: 2, winRate: 0.5 }],
    },
  },
  styleMetrics: {
    aggression: 50,
    tactical: 50,
    positional: 50,
    endgame: 50,
    sampleSize: 2,
  },
  gameCount: 2,
  bookSource: "provider",
  requestedScope: "all-time",
};

async function seedProfile(page: import("@playwright/test").Page, username: string) {
  await page.goto("/");
  await page.evaluate(({ name }) => {
    sessionStorage.setItem(`play-profile:${name}`, JSON.stringify({
      username: name,
      fideEstimate: { rating: 1500 },
      ratings: { blitz: 1500 },
      maiaRating: 1500,
    }));
  }, { name: username });
}

test.describe("personalized repertoire loading", () => {
  test("retries a rate limit and deduplicates the play request", async ({ page }) => {
    let attempts = 0;
    await page.route("**/api/bot-data/retry-user?**", async (route) => {
      attempts++;
      if (attempts === 1) {
        await route.fulfill({
          status: 429,
          headers: { "Retry-After": "0" },
          contentType: "application/json",
          body: JSON.stringify({ error: "Rate limited" }),
        });
        return;
      }
      await route.fulfill({ status: 200, json: botData });
    });
    await seedProfile(page, "retry-user");

    await page.goto("/play/retry-user");

    await expect(page.getByText("Choose your color")).toBeVisible({ timeout: 10_000 });
    expect(attempts).toBe(2);
    await expect(page.locator('[data-square="e2"]')).toHaveCount(0);
  });

  test("keeps the fixed-color personal trie ahead of Maia", async ({ page }) => {
    const afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -";
    await page.route("**/api/bot-data/book-user?**", (route) => route.fulfill({
      status: 200,
      json: {
        ...botData,
        blackTrie: {
          [afterE4]: {
            totalGames: 4,
            moves: [{ uci: "d7d6", san: "d6", count: 4, winRate: 0.5 }],
          },
        },
      },
    }));
    await seedProfile(page, "book-user");

    await page.goto("/play/book-user");
    await page.getByRole("button", { name: /White/ }).click();
    await expect(page.locator('[data-square="e2"]')).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-square="e2"]').click();
    await page.locator('[data-square="e4"]').click();

    await expect(page.getByText("Following book-user's repertoire")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Out of book/)).toHaveCount(0);
  });

  test("uses Maia-3 for a legal out-of-book move", async ({ page }) => {
    await page.route("**/api/bot-data/maia-user?**", (route) => route.fulfill({
      status: 200,
      json: botData,
    }));
    await seedProfile(page, "maia-user");

    await page.goto("/play/maia-user");
    await page.getByRole("button", { name: /White/ }).click();
    await expect(page.locator('[data-square="e2"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Maia-3 out-of-book calibration ≈1,575 FIDE")).toBeVisible();

    await page.locator('[data-square="e2"]').click();
    await page.locator('[data-square="e4"]').click();

    await expect(page.getByText("Out of book · Maia-3")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/Using Stockfish for this move/)).toHaveCount(0);
  });

  test("discloses Stockfish when Maia initialization fails", async ({ page }) => {
    await page.route("**/api/bot-data/fallback-user?**", (route) => route.fulfill({
      status: 200,
      json: botData,
    }));
    await page.route("**/maia-worker.js", (route) => route.abort());
    await seedProfile(page, "fallback-user");

    await page.goto("/play/fallback-user");
    await page.getByRole("button", { name: /White/ }).click();
    await expect(page.locator('[data-square="a2"]')).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-square="a2"]').click();
    await page.locator('[data-square="a3"]').click();

    await expect(page.getByText(/Using Stockfish for this move/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Out of book · Stockfish")).toBeVisible();
  });

  test("fails closed when no validated repertoire can be loaded", async ({ page }) => {
    await page.route("**/api/bot-data/unavailable-user?**", (route) => route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Provider and cache unavailable" }),
    }));
    await seedProfile(page, "unavailable-user");

    await page.goto("/play/unavailable-user");

    await expect(page.getByRole("heading", { name: "Personalized practice unavailable" })).toBeVisible();
    await expect(page.getByText(/generic engine opponent/)).toBeVisible();
    await expect(page.getByText("Choose your color")).toHaveCount(0);
    await expect(page.locator('[data-square="e2"]')).toHaveCount(0);
  });
});
