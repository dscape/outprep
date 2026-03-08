---
topic: Positional Concepts in Move Selection
relevance: [style, positional, tactical, aggression, quiet-moves]
updated: 2026-03-08
---

# Positional Concepts in Move Selection

## Style Metrics

The engine analyzes the player's style from their game records:
- **Aggression**: Preference for captures and checks
- **Tactical**: Preference for sharp, forcing moves
- **Positional**: Preference for quiet, strategic moves
- **Endgame**: Proficiency in endgame technique

## Style Bonus Application

The `applyStyleBonus` function adjusts candidate move scores before Boltzmann selection:
- Capture bonus: +30cp (scaled by aggression metric)
- Check bonus: +25cp (scaled by tactical metric)
- Quiet bonus: +20cp (scaled by positional metric)
- Overall influence: 0.3 (30% of score comes from style)
- Skill damping: 0.5 (higher skill = less style influence)

## Known Issues
- Style bonuses are small relative to Stockfish score differences (which can be 100-500cp)
- At low temperatures, style bonuses have almost no effect
- At high temperatures, even large style bonuses get washed out
- The sweet spot is mid-range temperatures where style can tip the balance

## Tuning Strategies
- Increase `moveStyle.influence` to make style more impactful
- Scale bonuses with temperature (higher T → larger bonuses to remain relevant)
- Per-phase style influence (e.g., positional bonus matters more in middlegame)

## Experiment History
