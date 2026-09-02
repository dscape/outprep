import { expect, test } from "@playwright/test";

test("does not preload Stockfish on ordinary page visits", async ({ page }) => {
  const stockfishRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("stockfish.")) {
      stockfishRequests.push(request.url());
    }
  });

  await page.goto("/");
  await page.waitForTimeout(2_000);

  expect(stockfishRequests).toEqual([]);
});
