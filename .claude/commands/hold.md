---
description: Defer findings without losing them
argument-hint: "<ids> [reason]"
---

Defer the findings named in $ARGUMENTS: real, but not this round.

Record them in `.agents/handoff/TO_IMPLEMENTER.md` under a "Deferred" heading with the reason, and
exclude them from the current round's scope. Restate every held finding when the mission closes, so
nothing is lost between rounds.
