---
topic: Style Analysis and Move Selection Biases
relevance: [style, bias, move-type, capture, check, classification]
updated: 2026-03-08
---

# Style Analysis and Move Selection Biases

## Move Classification
Moves are classified by type:
- **Capture**: Takes an opponent's piece
- **Check**: Puts the king in check
- **Promotion**: Pawn reaches 8th rank
- **Castle**: King castles
- **Quiet**: Non-capturing, non-checking move

## Player Style Profiling
The engine computes style metrics from historical games:
- **Aggression score** [0-1]: Ratio of captures/checks to total moves
- **Tactical score** [0-1]: Preference for forcing sequences
- **Positional score** [0-1]: Preference for strategic, quiet moves
- **Endgame score** [0-1]: Performance differential in endgame positions

## How Style Affects Selection
1. Each candidate move is classified by type
2. Style bonuses are applied based on the player's profile:
   - Aggressive player → captures get a score boost
   - Positional player → quiet moves get a boost
3. Modified scores feed into Boltzmann selection

## Current Limitations
- Style metrics are computed globally (not per-phase)
- The bonus values (30cp, 25cp, 20cp) are fixed, not calibrated per player
- Skill damping reduces style influence for higher-rated players
- Style bonuses don't consider the strategic context of the position

## Improvement Ideas
- Per-phase style profiling (player might be aggressive in middlegame, positional in endgame)
- Adaptive bonus scaling based on score spread
- Consider opponent's last move (reactive style patterns)

## Experiment History
