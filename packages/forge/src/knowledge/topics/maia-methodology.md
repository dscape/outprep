---
topic: Maia Chess Methodology
relevance: [accuracy, evaluation, benchmark, move-prediction, methodology]
updated: 2026-03-08
---

# Maia Chess Methodology

## Key Concepts

Maia is a family of chess engines trained to predict human moves at specific Elo levels. The foundational Maia paper (McIlroy-Young et al., 2020) introduced move prediction accuracy as the primary metric for human-like play.

### Move Prediction Accuracy
- **Definition**: Top-1 accuracy — the fraction of positions where the model's best move matches the human's actual move.
- **Maia-1 results**: ~51-53% accuracy across different Elo bands (Maia-1100 through Maia-1900).
- **Random baseline**: ~3% (there are ~30 legal moves per position on average).
- **Stockfish baseline**: ~35-45% (plays "correctly" but not "humanly").
- **Our current accuracy**: ~31% (room to improve toward Maia's 53%).

### Key Methodological Requirements
1. **Held-out test set**: Never evaluate on training data. Split games into train/test BEFORE building any player profile.
2. **Phase-balanced sampling**: Ensure opening, middlegame, and endgame positions are represented proportionally.
3. **Elo-specific evaluation**: Measure accuracy within Elo bands, not just overall.
4. **Sufficient sample size**: At least 1000 positions per evaluation for statistical power.
5. **Deterministic seeding**: Same seed = same evaluation for reproducibility.

### Maia-2 Improvements
- **Personalization**: Per-player models rather than per-Elo-band.
- **Win-rate-based blunder definition**: Blunder = move causing ≥10% win-rate loss.
- **Time-aware modeling**: Considers time pressure effects on move quality.
- **Result**: ~58% accuracy on personalized test sets.

## Common Pitfalls
- **Data leakage through opening trie**: If the bot learns openings from ALL games and is tested on the same games, book coverage inflates accuracy. Must use train/test split.
- **Mean CPL vs distribution**: Two players can have the same mean CPL but very different error profiles. Match the distribution, not just the mean.
- **Sample size**: 50 positions is too few for reliable comparison. Need 200+ per player for meaningful signal.
- **Phase imbalance**: Without phase-balanced sampling, evaluations are dominated by opening positions (which often have high book coverage).

## Research Insights
- Maia found that **lower Elo bands are harder to predict** because play is more random.
- **Opening accuracy is highest** due to standard opening theory.
- **Endgame accuracy is lowest** because endgame play varies widely by skill level.
- Temperature in Boltzmann selection should be **higher for lower Elo** (more randomness).

## Open Questions
- Can per-player temperature curves exceed Maia's per-band accuracy?
- Does position complexity affect optimal temperature independently of Elo?
- Can style metrics (aggression, positional, tactical) improve prediction beyond Elo alone?
