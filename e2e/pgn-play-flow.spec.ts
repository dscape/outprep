import { test, expect } from "@playwright/test";

// Small PGN with 3 games — "John Smith" is clearly the main player
const TEST_PGN = `[Event "Club Championship"]
[Site "Local Club"]
[Date "2024.01.15"]
[Round "1"]
[White "John Smith"]
[Black "Alice Johnson"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 1-0

[Event "Club Championship"]
[Site "Local Club"]
[Date "2024.01.16"]
[Round "2"]
[White "Bob Williams"]
[Black "John Smith"]
[Result "0-1"]

1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 4. e3 O-O 5. Bd3 d5 6. Nf3 c5 7. O-O dxc4 8. Bxc4 Nc6 0-1

[Event "Club Championship"]
[Site "Local Club"]
[Date "2024.01.17"]
[Round "3"]
[White "John Smith"]
[Black "Carol Davis"]
[Result "1/2-1/2"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be2 e5 7. Nb3 Be7 8. O-O O-O 1/2-1/2`;

test.describe("PGN upload → play flow", () => {
  test("uploads PGN, scouts player, plays game without 'Downloading games from platform'", async ({ page }) => {
    // Collect all text that appears on screen to check for bad messages
    const seenTexts: string[] = [];
    const badMessage = "Downloading games from platform";

    // 1. Go to home page
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("outprep");

    // 2. Click "paste PGN text" to open the textarea
    const pasteBtn = page.locator("button", { hasText: "paste PGN text" });
    await expect(pasteBtn).toBeVisible();
    await pasteBtn.click();

    // 3. Fill in PGN text and click Process
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible();
    await textarea.fill(TEST_PGN);

    const processBtn = page.locator("button", { hasText: "Process" });
    await expect(processBtn).toBeEnabled();
    await processBtn.click();

    // 4. Wait for redirect to /player/pgn:John Smith (auto-inferred player)
    await expect(page).toHaveURL(/\/player\/pgn:/, { timeout: 15_000 });

    // 5. Verify scout page loads with player profile
    await expect(page.locator("h2", { hasText: "John Smith" })).toBeVisible({ timeout: 10_000 });
    // Should show analyzed games info
    await expect(page.getByText(/\d+ games analyzed/)).toBeVisible({ timeout: 10_000 });

    // 6. Click Play button
    const playBtn = page.locator("button", { hasText: /^Play / });
    await expect(playBtn).toBeVisible({ timeout: 10_000 });
    await playBtn.click();

    // 7. Verify we're on the play page
    await expect(page).toHaveURL(/\/play\/pgn:/, { timeout: 10_000 });

    // 8. Assert "Downloading games from platform" is NEVER shown
    // Check current page text
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain(badMessage);

    // 9. Color selection should appear (possibly immediately — PGN profiles are cached)
    await expect(page.getByText("Choose your color")).toBeVisible({ timeout: 15_000 });

    // Double-check bad message didn't flash
    const bodyTextAfterColor = await page.locator("body").innerText();
    expect(bodyTextAfterColor).not.toContain(badMessage);

    // 10. Select White
    await page.locator("button", { hasText: "White" }).click();

    // 11. Wait for board to load
    await expect(page.locator('[data-square="e2"]')).toBeVisible({ timeout: 60_000 });

    // 12. Play e4
    await page.locator('[data-square="e2"]').click();
    await page.locator('[data-square="e4"]').click();

    // 13. Wait for bot response
    await page.waitForTimeout(5_000);

    // 14. Resign
    const resignBtn = page.locator("button", { hasText: "Resign" });
    await expect(resignBtn).toBeVisible();
    await resignBtn.click();

    // 15. Analysis page loads
    await expect(page).toHaveURL(/\/analysis\//, { timeout: 15_000 });
    await expect(page.getByText(/You lost|You won|Draw/)).toBeVisible({ timeout: 10_000 });
  });

  test("PGN player loading labels never mention 'platform' download", async ({ page }) => {
    // Pre-seed sessionStorage with PGN data, then navigate directly to play page
    await page.goto("/");
    await page.evaluate((pgn) => {
      // Simulate what PGNDropZone does: parse and store in sessionStorage
      // We store a minimal profile to test the play page in isolation
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
    }, TEST_PGN);

    // Navigate directly to play page for PGN player
    await page.goto("/play/pgn:TestBot");

    // Should go straight to color selection (profile cached, PGN bot data is instant)
    await expect(page.getByText("Choose your color")).toBeVisible({ timeout: 15_000 });

    // The bad message should never have appeared
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("Downloading games from platform");
    expect(bodyText).not.toContain("Fetching game history");
  });
});
