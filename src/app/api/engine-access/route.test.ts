import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkBotId: vi.fn(),
}));

vi.mock("botid/server", () => ({ checkBotId: mocks.checkBotId }));

import { POST } from "./route";

describe("engine access", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows human browser sessions", async () => {
    mocks.checkBotId.mockResolvedValue({ isBot: false });

    const response = await POST();

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("rejects bots before engine assets are preloaded", async () => {
    mocks.checkBotId.mockResolvedValue({ isBot: true });

    const response = await POST();

    expect(response.status).toBe(403);
  });

  it("fails closed when BotID is unavailable", async () => {
    mocks.checkBotId.mockRejectedValue(new Error("BotID unavailable"));

    const response = await POST();

    expect(response.status).toBe(503);
  });
});
