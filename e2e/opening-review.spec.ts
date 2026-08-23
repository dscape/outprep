import { expect, test } from "@playwright/test";

test("game review classifies the opening locally", async ({ page }) => {
  const explorerRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("explorer.lichess.ovh")) {
      explorerRequests.push(request.url());
    }
  });

  await page.route("**/api/analysis?**", (route) =>
    route.fulfill({ status: 404, body: "{}" }),
  );
  await page.goto("/");
  await page.evaluate(() => {
    sessionStorage.setItem("game:scotch-review", JSON.stringify({
      pgn: `
[Event "Practice"]
[White "You"]
[Black "TestBot"]
[Result "1/2-1/2"]

1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Nxd4 1/2-1/2
`,
      result: "1/2-1/2",
      playerColor: "white",
      openingName: "Scotch Game",
      opponentUsername: "TestBot",
      precomputedMoves: [],
      precomputedSummary: {
        averageCentipawnLoss: 0,
        accuracy: 100,
        blunders: 0,
        mistakes: 0,
        inaccuracies: 0,
      },
    }));
  });

  await page.goto("/analysis/scotch-review");

  await expect(page.getByText("Scotch Game · 4 moves")).toBeVisible();
  expect(explorerRequests).toEqual([]);
});
