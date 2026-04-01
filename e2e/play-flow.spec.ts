import { test, expect } from "@playwright/test";

test.describe("Play flow: tournament → game → player → play → analysis", () => {
  test("full e2e user journey", async ({ page }) => {
    // 1. Home page
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("outprep");

    // 2. Click a tournament
    const eventLink = page.locator('a[href*="/event/"]').first();
    await expect(eventLink).toBeVisible();
    const eventName = await eventLink.innerText();
    await eventLink.click();

    // 3. Tournament page — verify games list
    await expect(page.locator("h1")).toContainText(eventName.split("\n")[0]);
    const gameLinks = page.locator('a[href*="/game/"]');
    await expect(gameLinks.first()).toBeVisible({ timeout: 10_000 });

    // 4. Click first game
    await gameLinks.first().click();

    // 5. Game page — verify board and move list
    await expect(page.locator('[data-square="e2"]')).toBeVisible({ timeout: 10_000 });
    // Verify move list has at least one move button
    await expect(page.locator("button[data-ply]").first()).toBeVisible();

    // 6. Click a player name to go to their profile
    const playerLink = page.locator('a[href*="/player/"]').first();
    await expect(playerLink).toBeVisible();
    const playerName = await playerLink.innerText();
    await playerLink.click();

    // 7. Player/scout page — verify profile loaded
    await expect(page.locator("h2, h1").first()).toContainText(
      playerName.replace(/^GM\s*/, "").split(",")[0],
      { timeout: 15_000 }
    );
    // Wait for at least some data to appear (ratings or game count)
    await expect(page.getByText(/games analyzed|Classical|Rapid|Blitz/)).toBeVisible({ timeout: 15_000 });

    // 8. Click Play button
    const playBtn = page.locator("button", { hasText: /^Play / });
    await expect(playBtn).toBeVisible({ timeout: 10_000 });
    await playBtn.click();

    // 9. Color selection page
    await expect(page.getByText("Choose your color")).toBeVisible({ timeout: 15_000 });

    // 10. Select White
    await page.locator("button", { hasText: "White" }).click();

    // 11. Wait for board to load (bot-data + engine init)
    await expect(page.locator('[data-square="e2"]')).toBeVisible({ timeout: 60_000 });

    // 12. Play e4
    await page.locator('[data-square="e2"]').click();
    await page.locator('[data-square="e4"]').click();

    // 13. Wait for bot response (piece appears on a new square)
    await page.waitForTimeout(5_000);

    // 14. Play Nf3
    await page.locator('[data-square="g1"]').click();
    await page.locator('[data-square="f3"]').click();

    // 15. Wait for bot response
    await page.waitForTimeout(5_000);

    // 16. Resign
    const resignBtn = page.locator("button", { hasText: "Resign" });
    await expect(resignBtn).toBeVisible();
    await resignBtn.click();

    // 17. Analysis page — verify key elements
    await expect(page).toHaveURL(/\/analysis\//, { timeout: 15_000 });
    await expect(page.getByText(/You lost|You won|Draw/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/\d+% accuracy/).first()).toBeVisible();
    await expect(page.getByText("COACH'S NOTES")).toBeVisible();

    // Verify move list shows at least our first move
    await expect(page.locator("button[data-ply]").first()).toBeVisible();
  });

  test("color selection shows correct king icons for each color", async ({ page }) => {
    // Seed PGN data so we can reach color selection without network requests
    await page.goto("/");
    await page.evaluate(() => {
      const profile = {
        username: "TestBot",
        platform: "pgn",
        totalGames: 1,
        analyzedGames: 1,
        style: { aggression: 50, tactical: 50, positional: 50, endgame: 50, sampleSize: 1 },
        weaknesses: [],
        openings: { white: [], black: [] },
        prepTips: [],
        lastComputed: Date.now(),
        games: [
          {
            white: "TestBot",
            black: "Opponent",
            result: "1-0",
            date: "2024.01.15",
            event: "Test",
            moves: "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7",
          },
        ],
      };
      sessionStorage.setItem("pgn-import:TestBot", JSON.stringify(profile));
      sessionStorage.setItem(
        "play-profile:TestBot",
        JSON.stringify({ username: "TestBot", fideEstimate: { rating: 0 } })
      );
    });

    await page.goto("/play/pgn:TestBot");
    await expect(page.getByText("Choose your color")).toBeVisible({ timeout: 15_000 });

    // Unicode chess kings:
    //   ♚ (U+265A, filled/visually white on dark bg) should be on the "White" button
    //   ♔ (U+2654, outlined/visually dark on dark bg) should be on the "Black" button
    const whiteBtn = page.locator("button", { hasText: "White" });
    const blackBtn = page.locator("button", { hasText: "Black" });

    await expect(whiteBtn).toContainText("\u265A"); // ♚ — filled king, appears white on dark bg
    await expect(blackBtn).toContainText("\u2654"); // ♔ — outlined king, appears dark on dark bg
  });
});
