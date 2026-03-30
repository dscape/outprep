import { describe, it, expect } from "vitest";
import { matchesPlayerName, crc32 } from "./player-name";

describe("matchesPlayerName", () => {
  it("matches exact full name", () => {
    expect(matchesPlayerName("Firouzja, Alireza", "Firouzja, Alireza")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(matchesPlayerName("FIROUZJA, ALIREZA", "firouzja, alireza")).toBe(true);
  });

  it("matches abbreviated first name (PGN style)", () => {
    expect(matchesPlayerName("Firouzja,A", "Firouzja, Alireza")).toBe(true);
  });

  it("matches abbreviated with period", () => {
    expect(matchesPlayerName("Firouzja, A.", "Firouzja, Alireza")).toBe(true);
  });

  it("matches slug format with FIDE ID", () => {
    expect(matchesPlayerName("Firouzja, Alireza", "firouzja-alireza-12573981")).toBe(true);
  });

  it("matches slug format without FIDE ID", () => {
    expect(matchesPlayerName("Firouzja, Alireza", "firouzja-alireza")).toBe(true);
  });

  it("does NOT match different players", () => {
    expect(matchesPlayerName("Carlsen, Magnus", "Firouzja, Alireza")).toBe(false);
  });

  it("does NOT match short substrings (prevents false positives)", () => {
    // "Li" is a real surname - should NOT match a longer name that contains "li"
    expect(matchesPlayerName("Li, A", "Firouzja, Alireza")).toBe(false);
  });

  it("matches Caruana abbreviation", () => {
    expect(matchesPlayerName("Caruana,F", "Caruana, Fabiano")).toBe(true);
  });

  it("matches with extra whitespace", () => {
    expect(matchesPlayerName("  Firouzja , Alireza  ", "Firouzja, Alireza")).toBe(true);
  });

  it("does NOT match when last names differ", () => {
    expect(matchesPlayerName("Nakamura, Hikaru", "Firouzja, Alireza")).toBe(false);
  });

  it("matches word-based: all name parts present", () => {
    // PGN might have different ordering or formatting
    expect(matchesPlayerName("Alireza Firouzja", "firouzja-alireza")).toBe(true);
  });
});

describe("crc32", () => {
  it("produces deterministic output", () => {
    const moves = "e4 e5 Nf3 Nc6 Bb5 a6";
    expect(crc32(moves)).toBe(crc32(moves));
  });

  it("produces different output for different inputs", () => {
    expect(crc32("e4 e5 Nf3 Nc6 Bb5 a6")).not.toBe(crc32("d4 d5 c4 e6"));
  });

  it("returns 8-character hex string", () => {
    const result = crc32("test");
    expect(result).toMatch(/^[0-9a-f]{8}$/);
  });

  it("game IDs are stable across calls (regression: evals survive refresh)", () => {
    const moves = "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6";
    const username = "alireza-firouzja-12573981";
    const id1 = `fide:${username}:${crc32(moves)}`;
    const id2 = `fide:${username}:${crc32(moves)}`;
    expect(id1).toBe(id2);
  });
});
