---
topic: Opening Theory and Book Matching
relevance: [opening, trie, book, repertoire, opening-theory]
updated: 2026-03-08
---

# Opening Theory and Book Matching

## Opening Trie Design

The bot uses a trie (prefix tree) built from the player's actual games to reproduce their opening repertoire. Each node stores:
- Move frequencies (how often the player played each move)
- Win rates (how often each line resulted in a win)
- Minimum game threshold (default: 3 games to include a move)

## Key Parameters
- `trie.maxPly: 40` — Book covers up to move 20 (40 half-moves)
- `trie.minGames: 3` — Require at least 3 games with this line
- `trie.winBias: 0` — Weight toward winning lines (0 = pure frequency)

## Impact on Metrics
- **Match rate**: Opening trie directly contributes to accuracy through exact-match book moves
- **Book coverage**: Typically 5-20% of test positions fall in the book
- **Risk**: If trie is built from test games, it inflates accuracy (data leakage)

## Tuning Strategies
- **minGames**: Lower = more book coverage but less reliable lines. Higher = fewer but more confident lines.
- **winBias**: Positive values favor winning lines. Negative values favor variety. Zero = match actual frequency.
- **maxPly**: Deeper book coverage but requires more games per line to be reliable.

## Experiment History
