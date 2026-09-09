---
description: Dismiss findings, recording the reason
argument-hint: "<ids> [reason]"
---

Dismiss the findings named in $ARGUMENTS.

Verify each one in the code first — rejecting a real bug because you designed the thing is the exact
bias this pipeline exists to defeat. If a finding turns out to be real and serious, say so rather
than dropping it silently.

Record each dismissal and its reason in `.agents/handoff/TO_IMPLEMENTER.md` under an explicit
"Rejected — do not implement" heading, so the implementer does not re-raise it and the decision stays
auditable. A dropped finding is never silently forgotten.
