---
description: Act on findings from the other session
argument-hint: "[ids] (empty = all open findings)"
---

Act on the findings named in $ARGUMENTS, or on every open finding in the newest round if no ids given.

First record the disposition in the handoff file, then act. If a finding is one you disagree with,
say so *before* acting — but the user has instructed you to apply it, so apply it unless it is unsafe.

If the work is implementation code, it is not yours to write: append it to
`.agents/handoff/TO_IMPLEMENTER.md` as the next round instead, and say so. Only the trivial-edit
escape hatch in `.agents/rules/model_delegation.md` §2 may be handled inline — comments, docs, a
verified one-liner, a config value, a tool-verified rename.
