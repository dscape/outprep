---
topic: Boltzmann Temperature Tuning
relevance: [temperature, boltzmann, softmax, move-selection, skill-mapping]
updated: 2026-03-08
---

# Boltzmann Temperature Tuning

## Key Concepts

Boltzmann selection applies a softmax over Stockfish candidate scores:

```
P(move_i) = exp(score_i / T) / Σ exp(score_j / T)
```

Where T is the temperature parameter:
- **T → 0**: Deterministic (always picks highest-scoring move)
- **T → ∞**: Uniform random (all moves equally likely)
- **T = 1**: Scores directly determine probabilities

## Current Implementation

Temperature lookup table maps skill level to temperature:

| Skill | Elo Range   | Temperature | Behavior |
|-------|------------|-------------|----------|
| 0-3   | 1100-1400  | 130         | Very random, frequent errors |
| 4-6   | 1400-1600  | 70          | Moderate randomness |
| 7-9   | 1600-1800  | 38          | Picks best ~40-50% |
| 10-12 | 1800-2000  | 20          | Picks best ~55-65% |
| 13-15 | 2000-2200  | 10          | Picks best ~75% |
| 16-18 | 2200-2500  | 4           | Picks best ~85-90% |
| 19-20 | 2500-2800  | 1           | Near-deterministic |

Temperature floor: 0.1 (prevents division by zero)
Temperature scale: 15 (global multiplier)

## Known Issues

1. **Per-band, not per-player**: Temperature is based on Elo band, but individual players at the same Elo can have very different randomness levels.
2. **No phase awareness**: Same temperature for opening, middlegame, and endgame. But humans typically:
   - Play more "by the book" in openings (lower effective temperature)
   - Make more varied moves in complex middlegames (higher temperature)
   - Have more deterministic endgame technique (lower temperature in won positions)
3. **Score units matter**: Temperature interacts with Stockfish score scale. A 100cp temperature with scores in centipawns behaves differently than with normalized scores.

## Tuning Strategies

### Strategy 1: Per-Phase Temperature
Add phase-dependent multipliers:
- Opening: 0.7-0.9x (more deterministic)
- Middlegame: 1.1-1.4x (more varied)
- Endgame: 0.8-1.0x (depends on position)

### Strategy 2: Per-Player Temperature
Derive temperature from the player's actual error profile:
- High mistake rate → higher temperature
- Low mistake rate → lower temperature
- Use `errorProfile.phaseErrors` to compute per-phase temperature

### Strategy 3: Position-Complexity Temperature
Scale temperature by position complexity:
- Many captures available → higher temperature (tactical uncertainty)
- Few legal moves → lower temperature (forced play)
- Even evaluation → higher temperature (harder to choose)

### Strategy 4: Score-Distribution Temperature
Instead of fixed temperature, adapt based on the score spread:
- Large spread between candidates → lower temperature (clear best move)
- Small spread → higher temperature (many reasonable options)

## Impact Assessment
- Temperature is the **single most impactful parameter** for move prediction accuracy.
- A 10% change in temperature typically yields 1-3pp accuracy change.
- Over-tuning temperature risks overfitting to the test set.

## Experiment History
