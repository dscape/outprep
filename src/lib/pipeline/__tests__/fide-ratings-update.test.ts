import { describe, it, expect } from "vitest";
import { parseFideText } from "@/lib/pipeline/fide-ratings-update";

// Helper: build a FIDE fixed-width line matching the documented column layout.
// The file format has a header line followed by data lines.
function makeFideLine(fields: {
  fideId?: string;
  name?: string;
  federation?: string;
  title?: string;
  standardRating?: string;
  rapidRating?: string;
  blitzRating?: string;
  birthYear?: string;
}): string {
  // Total width we need: at least 156 chars
  const line = " ".repeat(200).split("");

  const pad = (val: string, start: number, end: number) => {
    const s = val.padEnd(end - start, " ").slice(0, end - start);
    for (let i = 0; i < s.length; i++) line[start + i] = s[i];
  };

  pad(fields.fideId ?? "", 0, 15);
  pad(fields.name ?? "", 15, 76);
  pad(fields.federation ?? "", 76, 79);
  pad(fields.title ?? "", 84, 88);
  pad(fields.standardRating ?? "", 113, 119);
  pad(fields.rapidRating ?? "", 126, 132);
  pad(fields.blitzRating ?? "", 139, 145);
  pad(fields.birthYear ?? "", 152, 156);

  return line.join("");
}

const HEADER_LINE = "ID Number       Name                       Fed   Title  Standard Rapid  Blitz  B-day";

describe("parseFideText", () => {
  it("parses a matching player record", () => {
    const line = makeFideLine({
      fideId: "1503014",
      name: "Carlsen, Magnus",
      federation: "NOR",
      title: "GM  ",
      standardRating: "2830  ",
      rapidRating: "2850  ",
      blitzRating: "2800  ",
      birthYear: "1990",
    });
    const text = `${HEADER_LINE}\n${line}`;
    const ids = new Set(["1503014"]);
    const records = parseFideText(text, ids);

    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.fideId).toBe("1503014");
    expect(r.name).toBe("Carlsen, Magnus");
    expect(r.federation).toBe("NOR");
    expect(r.title).toBe("GM");
    expect(r.standardRating).toBe(2830);
    expect(r.rapidRating).toBe(2850);
    expect(r.blitzRating).toBe(2800);
    expect(r.birthYear).toBe(1990);
  });

  it("skips lines shorter than 145 characters", () => {
    const shortLine = "1503014        Carlsen, Magnus";
    const text = `${HEADER_LINE}\n${shortLine}`;
    const ids = new Set(["1503014"]);
    expect(parseFideText(text, ids)).toHaveLength(0);
  });

  it("skips the header line (non-numeric FIDE ID)", () => {
    const line = makeFideLine({ fideId: "ID Number", name: "Header" });
    const text = `${HEADER_LINE}\n${line}`;
    const ids = new Set(["ID Number"]);
    expect(parseFideText(text, ids)).toHaveLength(0);
  });

  it("filters out IDs not in filterIds", () => {
    const line = makeFideLine({
      fideId: "9999999",
      name: "Unknown, Player",
      standardRating: "2000",
    });
    const text = `${HEADER_LINE}\n${line}`;
    const ids = new Set(["1503014"]); // different ID
    expect(parseFideText(text, ids)).toHaveLength(0);
  });

  it("handles absent ratings as null", () => {
    const line = makeFideLine({
      fideId: "1503014",
      name: "Carlsen, Magnus",
      federation: "NOR",
      standardRating: "",
    });
    const text = `${HEADER_LINE}\n${line}`;
    const ids = new Set(["1503014"]);
    const [r] = parseFideText(text, ids);
    expect(r.standardRating).toBeNull();
    expect(r.rapidRating).toBeNull();
    expect(r.blitzRating).toBeNull();
    expect(r.birthYear).toBeNull();
    expect(r.title).toBeNull();
  });
});
