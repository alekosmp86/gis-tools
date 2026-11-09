# Routine jobs: Cargas de Coberturas as a job card (CJ-1 to CJ-9)

## Context

`coverage-loads` is a separate module with its own home card, page (`/tools/m/coverage-loads`) and navigation entry. It must also appear inside "Trabajos de rutina" as one more job card, with an "Abrir" button that opens its workflow (connection, Indicadores LTE, Cargas SHP, Avance FTTH, Capas SIGRA, Resultado) as it runs today. The modules stay separate: routine-jobs must not import coverage-loads, so the card travels through a UI slot (module_authoring: mounting a slot is a deliberate core-side change).

## Slot and host

- CJ-1: `UiSlot` gains `ROUTINE_JOBS_LIST` (`"routineJobs.list"`). It is documented in the mounted-slots table of `.agents/rules/module_authoring.md`, with the host `routine-jobs` dashboard.
- CJ-2: `UiContribution` gains an optional `description` (the card text). Slots that do not use it ignore it.
- CJ-3: `RoutineJobsDashboard` lists its own jobs first and then the contributions of `ROUTINE_JOBS_LIST` sorted by `order`. A contributed card shows its `label` as title, its `description` and an "Abrir" button, with the look of the existing cards. With no contributions the page is identical to today.
- CJ-4: "Abrir" on a contributed card opens its `Component` in the same job panel as the monthly job (title, "Volver a la lista" button), wrapped in `ModuleErrorBoundary`. Going back to the list and opening it again behaves like opening any job. The dashboard never imports `coverage-loads`.

## Coverage loads

- CJ-5: `coverage-loads` contributes to `ROUTINE_JOBS_LIST` with id `coverage-loads.job`, label "Cargas de Coberturas", a one-sentence description (load of the LTE indicators, SHP layers, Avance FTTH and SIGRA layers) and a component that renders its workflow (`CoverageWorkflow`) as the page does, without the page layout and title.
- CJ-6: Its `HOME_TOOL_GRID` card is removed: `CoverageLoadsHomeCard` and its stylesheet are deleted, with their test. The page `/tools/m/coverage-loads`, the navigation entry, the status chip, the endpoints and the wiki stay.
- CJ-7: The home card of routine-jobs and the monthly job are unchanged.
- CJ-9: Removing the `coverage-loads` module leaves the routine-jobs page with only its own job card and no error.

## Documentation

- CJ-8: The routine-jobs wiki index says that "Cargas de Coberturas" is opened from the Trabajos de rutina list (and still has its own page), and the coverage-loads wiki intro says the same.

## Out of scope

- Moving any coverage-loads code into routine-jobs, changing its workflow, endpoints or connection handling, other jobs' cards.

## Acceptance criteria count

CJ-1 to CJ-9 (9 criteria).
