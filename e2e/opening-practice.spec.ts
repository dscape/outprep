import { expect, test } from "@playwright/test";

const frenchOpening = {
  eco: "C14",
  name: "French Defense: Classical Variation",
  family: "French Defense",
  games: 2,
  pct: 100,
  winRate: 50,
  drawRate: 50,
  lossRate: 0,
};

async function seedFrenchProfile(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.evaluate(({ opening }) => {
    const openings = { white: [], black: [opening] };
    const profile = {
      username: "TestBot",
      platform: "pgn",
      totalGames: 2,
      analyzedGames: 2,
      style: {
        aggression: 50,
        tactical: 50,
        positional: 50,
        endgame: 50,
        sampleSize: 2,
      },
      weaknesses: [],
      openings,
      prepTips: [],
      bySpeed: {
        classical: {
          games: 2,
          style: {
            aggression: 50,
            tactical: 50,
            positional: 50,
            endgame: 50,
            sampleSize: 2,
          },
          openings,
          weaknesses: [],
        },
      },
      lastComputed: Date.now(),
      games: [
        {
          white: "Opponent One",
          black: "TestBot",
          result: "0-1",
          date: "2024.01.15",
          event: "Test",
          eco: "C14",
          opening: "French Defense: Classical Variation",
          timeControl: "1800",
          moves: "e4 e6 d4 d5 e5 c5 Nf3 Nc6",
          pgn: "1. e4 e6 2. d4 d5 3. e5 c5 4. Nf3 Nc6",
        },
        {
          white: "Opponent Two",
          black: "TestBot",
          result: "1/2-1/2",
          date: "2024.01.16",
          event: "Test",
          eco: "C14",
          opening: "French Defense: Classical Variation",
          timeControl: "1800",
          moves: "e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7",
          pgn: "1. e4 e6 2. d4 d5 3. Nc3 Nf6 4. Bg5 Be7",
        },
      ],
    };

    sessionStorage.setItem("pgn-import:TestBot", JSON.stringify(profile));
    sessionStorage.setItem(
      "play-profile:TestBot",
      JSON.stringify({
        username: "TestBot",
        fideEstimate: { rating: 1500 },
        maiaRating: 1500,
      }),
    );
  }, { opening: frenchOpening });
}

test.describe("opening row practice", () => {
  test("autoplays only the family-defining moves, then follows the player's book", async ({ page }) => {
    await seedFrenchProfile(page);
    await page.goto("/player/pgn:TestBot");

    await page.getByRole("button", { name: "As Black" }).click();

    const puzzleLink = page.getByRole("link", {
      name: "Solve French Defense puzzles on Lichess",
    });
    const playButton = page.getByRole("button", {
      name: "Play French Defense against the AI",
    });

    await expect(puzzleLink).toHaveAttribute(
      "href",
      "https://lichess.org/training/French_Defense",
    );
    await expect(puzzleLink).toHaveAttribute("target", "_blank");

    for (const link of [puzzleLink, playButton]) {
      const box = await link.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(40);
      expect(box?.height).toBeGreaterThanOrEqual(40);
    }

    await playButton.click();
    await expect(page).toHaveURL(/\/play\/pgn:TestBot/);
    expect(page.url()).toContain("openingName=French+Defense");
    expect(page.url()).toContain("color=black");
    await expect(page.getByText("Choose your color")).toHaveCount(0);
    await expect(page.locator('[data-square="e4"] [data-piece="wP"]'))
      .toBeVisible({ timeout: 60_000 });

    // Both sides' family-defining moves are autoplayed.
    await expect(page.locator('[data-square="e6"] [data-piece="bP"]')).toBeVisible();
    await expect(page.locator('[data-square="e2"] [data-piece]')).toHaveCount(0);
    await expect(page.locator('[data-square="e7"] [data-piece]')).toHaveCount(0);

    // C14 must not force the Classical continuation. Training starts after
    // 1.e4 e6, while both d-pawns remain available for further branches.
    await expect(page.locator('[data-square="d2"] [data-piece="wP"]')).toBeVisible();
    await expect(page.locator('[data-square="d7"] [data-piece="bP"]')).toBeVisible();
    await expect(page.locator('[data-square="d4"] [data-piece]')).toHaveCount(0);
    await expect(page.locator('[data-square="d5"] [data-piece]')).toHaveCount(0);

    await page.locator('[data-square="d2"]').click();
    await page.locator('[data-square="d4"]').click();

    // TestBot's actual French repertoire contains 2...d5 in both games.
    await expect(page.locator('[data-square="d5"] [data-piece="bP"]'))
      .toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Following TestBot's repertoire")).toBeVisible();
    await expect(page.getByText(/Out of book/)).toHaveCount(0);
  });
});
