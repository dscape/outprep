---
topic: Outprep Engine Architecture
relevance: [engine, bot-controller, move-selector, architecture, pipeline]
updated: 2026-03-08
---

# Outprep Engine Architecture

## Move Selection Pipeline

The engine follows this pipeline for each move:

```
1. Opening Trie → Check if position is in the player's opening book
   ↓ (if no book move)
2. Phase Detection → Classify position as opening/middlegame/endgame
   ↓
3. Dynamic Skill → Adjust Stockfish skill level based on player error profile
   ↓
4. MultiPV Evaluation → Get top N candidate moves from Stockfish
   ↓
5. Style Bonus → Apply bonuses for moves matching player's style
   ↓
6. Boltzmann Selection → Sample from candidates using temperature-weighted softmax
   ↓
7. Think Time → Simulate human-like thinking time
```

## Key Modules

### move-selector.ts
- `boltzmannSelect(candidates, temperature)` — Core selection algorithm
- `temperatureFromSkill(skill, config)` — Maps skill level to temperature
- Temperature table: skill 0-3 → T=130 (very random) down to skill 19-20 → T=1 (near-deterministic)
- **Impact**: Temperature is the MOST impactful parameter for accuracy

### bot-controller.ts
- Orchestrates the full pipeline
- `getMove(fen)` → returns `{ uci, source, phase, dynamicSkill, candidates }`
- Manages the state machine: book → engine → select

### error-profile.ts
- `buildErrorProfileFromEvals(evalData)` — Computes per-phase error rates from Lichess evals
- Phases: opening, middlegame, endgame
- Error types: mistake (≥150cp), blunder (≥300cp)
- Used for dynamic skill adjustment

### move-style.ts
- `analyzeStyleFromRecords(records)` — Computes style metrics (aggression, tactical, positional, endgame)
- `applyStyleBonus(candidates, style, config)` — Adjusts candidate scores
- Bonuses: capture (+30), check (+25), quiet (+20), scaled by style weights

### phase-detector.ts
- `detectPhase(fen, config)` — Counts minor/major pieces
- Above 10 non-pawn pieces → opening, at or below 6 → endgame, else middlegame
- Critical: controls which error rates are used for dynamic skill

### complexity.ts
- `complexityDepthAdjust(fen, config)` — Adjusts Stockfish depth based on position complexity
- Tactical positions (many captures) → deeper search
- Quiet positions → shallower search
- Saves computation without losing accuracy

### opening-trie.ts
- `buildOpeningTrie(records, color)` — Constructs opening book from player's games
- `sampleTrieMove(trie, position)` — Samples with frequency + win-rate weighting
- `maxPly: 40` — Book covers up to move 20
- **Warning**: If built from test games, this leaks information

## Configuration (DEFAULT_CONFIG)
- 30+ tunable parameters across 9 sub-objects
- Most impactful for accuracy: `boltzmann.temperatureBySkill`
- Most impactful for CPL: `error.*` thresholds, `dynamicSkill.scale`
- Most impactful for blunders: `depthBySkill`, `boltzmann.temperatureFloor`

## Experiment History
