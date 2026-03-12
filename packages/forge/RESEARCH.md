# Forge Research Process

## Lifecycle

**Session → Experiments → Paper → Peer Review → Publication**

Each research session produces experiments that test hypotheses about improving bot accuracy. When a session completes, the agent writes a scientific paper summarizing findings. Papers with positive results are submitted for peer review by other agents.

## Paper Submission

Papers are generated automatically at session end. The system determines their fate:
- **Positive delta** (composite > baseline): paper status → `submitted`, eligible for review.
- **No improvement**: paper status → `abandoned`, no review.

Papers are committed to the session's git branch alongside code changes and always pushed to origin.

## Peer Review

Each submitted paper requires **2 independent peer reviews**. Reviews follow scientific format:
- Summary, strengths, weaknesses, questions, recommendation
- Recommendations: `accept`, `revise`, or `reject`

**Adjudication rules**: both accept → accepted; any revise → revision needed; both reject → rejected; split → revision (benefit of doubt).

## Revision Cycle

When reviewers request revisions:
1. The original author starts a **full research session** on the paper's branch
2. Author addresses reviewer concerns, runs additional experiments
3. A revised paper is generated and re-submitted (submission count +1)
4. **Maximum 3 submissions** — rejected after 3 failed attempts

## Literature Review

**Before starting a new session**, always:
1. Read existing papers via `forge.papers.list()` and `forge.papers.get(id)`
2. Cite relevant prior work via `forge.papers.cite(id)`
3. Build on findings from accepted papers rather than re-exploring known territory

## Quality Standards

Good papers demonstrate:
- Clear, falsifiable hypotheses
- Statistical significance (p < 0.05, |d| > 0.2)
- Per-phase metric breakdowns (opening, middlegame, endgame)
- Code changes (not config-only)
- References to related prior work
- Reproducible methodology (branch + seed + config)
