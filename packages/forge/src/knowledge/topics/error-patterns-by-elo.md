---
topic: Error Patterns by Elo Band
relevance: [error, blunder, mistake, elo, skill-level, cpl]
updated: 2026-03-08
---

# Error Patterns by Elo Band

## Overview

Players at different Elo levels make characteristically different types of errors. Understanding these patterns is essential for calibrating the bot's error profile.

## Error Rates by Band

| Elo Band     | Mean CPL | Blunder % | Mistake % | Phase with Most Errors |
|-------------|----------|-----------|-----------|----------------------|
| 1100-1400   | 80-120   | 8-12%     | 15-20%    | Middlegame |
| 1400-1600   | 50-80    | 5-8%      | 12-15%    | Middlegame |
| 1600-1800   | 35-50    | 3-5%      | 8-12%     | Endgame |
| 1800-2000   | 25-35    | 2-3%      | 5-8%      | Endgame |
| 2000-2200   | 15-25    | 1-2%      | 3-5%      | Even distribution |
| 2200+       | 8-15     | <1%       | 2-3%      | Complex middlegame |

## Phase-Specific Patterns

### Opening (moves 1-15)
- **Lower Elo**: High variance. May play random or memorized openings. Book coverage 30-50%.
- **Mid Elo**: More consistent. Knows main lines. Book coverage 50-70%.
- **High Elo**: Very consistent. Deep preparation. Book coverage 70-90%.
- **Error source**: Deviating from theory (lower Elo), novelty mistakes (higher Elo).

### Middlegame (moves 15-35)
- **Lower Elo**: Tactical oversights are the primary error. Missing forks, pins, skewers.
- **Mid Elo**: Positional misjudgments. Poor piece placement, pawn structure weakening.
- **High Elo**: Strategic errors. Incorrect plan, time management in complex positions.
- **Key insight**: Middlegame errors correlate strongly with position complexity.

### Endgame (moves 35+)
- **Lower Elo**: Fundamental technique errors. Stalemate traps, wrong bishop/pawn endings.
- **Mid Elo**: Technique is inconsistent. Knows some patterns but misses others.
- **High Elo**: Precise technique. Errors only in extremely complex endings.
- **Key insight**: Endgame accuracy has the widest variance across Elo bands.

## Implications for Bot Tuning

1. **Temperature should decrease with skill** — confirmed by Maia. Higher-rated players are more predictable.
2. **Phase-specific temperature** — middlegame needs higher temperature than opening/endgame at all levels.
3. **Blunder distribution matters** — it's not enough to match the overall blunder rate. The phase distribution of blunders must also match.
4. **Dynamic skill adjustment** — when the player's phase error rate is low, skill should increase (fewer errors); when high, skill should decrease.

## Experiment History
