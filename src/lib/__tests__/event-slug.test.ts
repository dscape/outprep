import { describe, expect, it } from "vitest";
import {
  assignEventSlugs,
  generateEventSlug,
} from "@/lib/event-slug";

describe("generateEventSlug", () => {
  it("normalizes punctuation and diacritics", () => {
    expect(generateEventSlug("Café Open — 2026")).toBe("cafe-open-2026");
  });

  it("uses a stable fallback for names without ASCII characters", () => {
    const slug = generateEventSlug("世界棋赛");
    expect(slug).toMatch(/^event-[a-f0-9]{10}$/);
    expect(generateEventSlug("世界棋赛")).toBe(slug);
  });
});

describe("assignEventSlugs", () => {
  it("preserves existing public URLs", () => {
    const assignments = assignEventSlugs(
      ["Renamed punctuation"],
      [{ name: "Renamed punctuation", slug: "legacy-event-url" }],
    );

    expect(assignments.get("Renamed punctuation")).toBe("legacy-event-url");
  });

  it("disambiguates names that normalize to the same slug", () => {
    const assignments = assignEventSlugs(
      ["SixDays Budapest May GM-A", "SixDays Budapest May GM A"],
      [],
    );

    const hyphenated = assignments.get("SixDays Budapest May GM-A");
    const spaced = assignments.get("SixDays Budapest May GM A");
    expect(hyphenated).not.toBe(spaced);
    expect(new Set(assignments.values()).size).toBe(2);
    expect(hyphenated!.length).toBeLessThanOrEqual(120);
    expect(spaced!.length).toBeLessThanOrEqual(120);
  });

  it("uses a deterministic suffix when the canonical slug is occupied", () => {
    const existing = [
      {
        name: "SixDays Budapest May GM A",
        slug: "sixdays-budapest-may-gm-a",
      },
    ];
    const first = assignEventSlugs(["SixDays Budapest May GM-A"], existing);
    const second = assignEventSlugs(["SixDays Budapest May GM-A"], existing);

    expect(first.get("SixDays Budapest May GM-A")).toBe(
      second.get("SixDays Budapest May GM-A"),
    );
    expect(first.get("SixDays Budapest May GM-A")).toMatch(
      /^sixdays-budapest-may-gm-a-[a-f0-9]{10}$/,
    );
  });

  it("rejects ambiguous existing event records", () => {
    expect(() =>
      assignEventSlugs([], [
        { name: "Same Event", slug: "same-event" },
        { name: "Same Event", slug: "same-event-2" },
      ]),
    ).toThrow("Event name has multiple slugs");
  });
});
