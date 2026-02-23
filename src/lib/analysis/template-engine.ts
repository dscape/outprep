import { KeyMoment, PlayerProfile, AnalysisSummary } from "../types";

interface NarrativeInput {
  result: "win" | "loss" | "draw";
  playerColor: "white" | "black";
  opening: string;
  summary: AnalysisSummary;
  keyMoments: KeyMoment[];
  profile: PlayerProfile;
  totalMoves: number;
}

export function generateNarrative(input: NarrativeInput): string {
  const { result, playerColor, opening, summary, keyMoments, profile, totalMoves } = input;

  const sentences: string[] = [];

  // Opening sentence
  const opponentOpenings = playerColor === "white"
    ? profile.openings.black
    : profile.openings.white;
  const matchingOpening = opponentOpenings.find(
    (o) => opening.toLowerCase().includes(o.name.toLowerCase().split(":")[0].trim())
  );

  if (matchingOpening) {
    sentences.push(
      `They played their standard ${matchingOpening.name} (${matchingOpening.pct}% of their ${playerColor === "white" ? "Black" : "White"} games).`
    );
  } else {
    sentences.push(
      `The game opened with the ${opening}, which is less common in their repertoire.`
    );
  }

  // Performance sentence
  if (summary.accuracy >= 90) {
    sentences.push(
      `You played excellent chess with ${summary.accuracy}% accuracy.`
    );
  } else if (summary.accuracy >= 75) {
    sentences.push(
      `Your play was solid at ${summary.accuracy}% accuracy, though there were some improvements available.`
    );
  } else {
    sentences.push(
      `Your accuracy was ${summary.accuracy}%, with ${summary.blunders} blunder${summary.blunders !== 1 ? "s" : ""} and ${summary.mistakes} mistake${summary.mistakes !== 1 ? "s" : ""} to address.`
    );
  }

  // Key moment analysis
  const prepHits = keyMoments.filter((m) => m.tag === "PREP HIT");
  const errors = keyMoments.filter((m) => m.tag === "YOUR ERROR");
  const predicted = keyMoments.filter((m) => m.tag === "PREDICTED");

  if (prepHits.length > 0) {
    const hit = prepHits[0];
    sentences.push(
      `You successfully exploited their patterns around move ${hit.moveNum}.`
    );
  }

  if (predicted.length > 0) {
    const weakMatch = profile.weaknesses[0];
    if (weakMatch) {
      sentences.push(
        `As expected, they showed vulnerability in their ${weakMatch.area.toLowerCase()} — this is a documented tendency (${weakMatch.stat}).`
      );
    }
  }

  if (errors.length > 0 && errors.length <= 2) {
    sentences.push(
      `Watch out for move ${errors[0].moveNum} — that was your main missed opportunity.`
    );
  } else if (errors.length > 2) {
    sentences.push(
      `Focus on moves ${errors.slice(0, 3).map((e) => e.moveNum).join(", ")} — these were your key missed opportunities.`
    );
  }

  // Result-based conclusion
  if (result === "win") {
    if (totalMoves < 30) {
      sentences.push("A convincing victory — your preparation paid off.");
    } else {
      sentences.push("Well played — you converted the advantage successfully.");
    }
  } else if (result === "loss") {
    const topOpening = opponentOpenings[0];
    if (topOpening) {
      sentences.push(
        `For the real game: expect ${topOpening.name}, and focus on avoiding the mistakes identified above.`
      );
    }
  } else {
    sentences.push(
      "A balanced game. Review the key moments to find where you could have pushed for more."
    );
  }

  return sentences.join(" ");
}

export function generateResultBanner(input: {
  result: "win" | "loss" | "draw";
  opponentUsername: string;
  fideEstimate: number;
  opening: string;
  totalMoves: number;
  accuracy: number;
}): string {
  const resultText = input.result === "win" ? "You won" : input.result === "loss" ? "You lost" : "You drew";
  return `${resultText} vs ${input.opponentUsername} (~${input.fideEstimate} FIDE) · ${input.opening} · ${input.totalMoves} moves · ${input.accuracy}% accuracy`;
}
