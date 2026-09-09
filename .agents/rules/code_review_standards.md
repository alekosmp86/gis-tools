# Code Review Standards

Binding on every review — the `code-reviewer` agent, the orchestrator's own read of a diff, and any
review a human asks for. A green gauntlet is the entry ticket to review, never its conclusion:
tests prove the code does what it does, not that it should be built that way.

Review in the order below. A diff can be perfectly correct and still be rejected on section 2.

## 1. Correctness

Bugs, data loss, race conditions, unhandled failure paths, wrong error handling, security holes.
Every finding above NIT carries a concrete failure scenario: specific inputs or state, and the
resulting wrong output, crash or cost. A finding without one is a preference.

## 2. Architecture and design — never skip this section

Judge the **shape** of the change, not only its behaviour. Ask explicitly, in writing:

- **Single Responsibility.** Does any file, class, component or method acquire a second reason to
  change? Name the responsibilities you counted.
- **God components and monolithic functions.** Did a file grow disproportionately? Compare it
  against its siblings and against its own size before the diff. A UI component that holds
  presentation *and* a form state machine *and* async submission *and* error rendering is a God
  component, whatever its line count.
- **Duplication as a design signal.** Two near-identical blocks, two copies of the same user-facing
  string, or two components solving the same input problem mean the second case was pasted rather
  than factored. This is the single most reliable sign that a change is structurally too big.
  Report it even when both copies are correct.
- **Layering.** Does domain logic sit in a service, a service reach into a component, or persistence
  leak a domain rule? Check the module's own declared layers (`domain/`, `services/`, `ui/`,
  `api/`) and say which one the logic belongs in.
- **Existing patterns.** Does the module already solve this problem somewhere? A new inline form
  next to an existing extracted form component is an inconsistency, not a style preference.
- **Interfaces and contracts.** Weak or lying types (`Promise<unknown> | void`, `any`, optional
  fields that are always present), props that force the caller to know the callee's internals,
  return values a caller cannot act on.
- **Open/Closed and dependency direction.** Does adding the *next* case require editing the same
  function again? Do concrete classes get instantiated where an injected collaborator belongs?

State plainly whether the diff is **the right size for the feature**, and if not, whether the excess
is scope (remove work) or structure (same work, better factored). Those have opposite fixes — do not
conflate them.

## 3. Project rules

`AGENTS.md` and every `.agents/rules/*.md` bind the diff. Notably: no monolithic functions,
dedicated single-responsibility helpers, modular CSS with no inline styles, Spanish user-facing
strings, comments only for critical non-obvious context, nothing hand-written under `src/app/`.

## 4. Tests

Real behavioural assertions, not restatements of the implementation. AAA. Boundary and failure
cases, not only the happy path. Mocks only at boundaries the module does not own — never a mock of
our own logic to make a test pass.

**A weakened, skipped or deleted test is an automatic BLOCKER.** Check the `-` lines of the test
diff specifically; an assertion loosened to reach green is worse than a failing test.

## 5. Severity

- **BLOCKER** — wrong behaviour, data loss, crash or security hole in normal use; or a weakened test.
- **MAJOR** — a real defect on a less common path, a genuine performance problem at realistic scale,
  a violated project rule, a structural violation from section 2, or a meaningful coverage gap.
- **MINOR** — real but low impact.
- **NIT** — cosmetic. Never triggers a fix round.

## 6. Obligations

- **Verify before rejecting.** Read the code before dismissing a finding, and before accepting one.
  A reviewer's prescription can itself be wrong — check that a suggested fix compiles against the
  real types before passing it to an implementer.
- **Challenge the premise.** If the plan or the requirement is what produced a bad structure, say so
  and name the decision. Reviewing only what the implementer controlled hides the real cause.
- **Report faithfully.** Never launder an unverified claim. Re-run the gates rather than trusting a
  report that says they passed.
