---
topic: Endgame Principles and Accuracy
relevance: [endgame, technique, phase, material, accuracy]
updated: 2026-03-08
---

# Endgame Principles and Accuracy

## Phase Detection
- Current definition: ≤6 non-pawn pieces → endgame
- This is a simplified heuristic. Real endgame detection considers:
  - Material balance
  - King activity
  - Pawn structure
  - Whether queens are off the board

## Endgame Accuracy Challenges
- **Widest variance by Elo**: Beginners might score 10% accuracy, masters 50%+
- **Fewer positions**: Games that reach endgame are a minority (20% target in phase-balanced sampling)
- **Technique-dependent**: Correct endgame play often has only 1-2 right moves vs many in middlegame
- **Tablebase positions**: Near-terminal positions have provably correct moves

## Tuning Strategies
- **Lower temperature in won positions**: When eval is clearly winning (>300cp), reduce temperature to play more precisely
- **Higher depth in endgame**: Endgame accuracy benefits from deeper search (longer-range plans)
- **Dynamic skill adjustment**: Endgame-specific skill adjustment based on endgame error rate

## Experiment History
