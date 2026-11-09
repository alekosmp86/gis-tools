# Routine jobs: real-run confirmation by password only (RC-1 to RC-6)

## Context

The real run of Cargar padrones, Cargar localidades, Unidad territorial and Actualizar padrón asks the user to type the destination table name again, besides the password (AC-32, CL-30, CL-47, AP-18, AP-31, AP-91, and the unit spec). The server never checks the typed name: it is a client-side gate only (`typedTable`, `typedTables`, `targetLabel` exist in `ui/` and are not in any request). The password is enough confirmation.

## Behaviour

- RC-1: In the four wizards the real run no longer asks for the destination table name. The Review step (and the persist panel of Actualizar padrón) shows only the password field; the field, its label and its hint are removed.
- RC-2: A real run is enabled by the same conditions as before minus the typed name: the password is filled, the selection is valid and, where it exists, the other confirmation (`confirm`, checkboxes) is given. The dry run is unchanged.
- RC-3: The client state no longer holds the typed table(s): `typedTable`, `typedTables` and `targetLabel` are removed from the confirmation types, their initial values, resets and the analysis' clearing of them. Requests are unchanged (they never carried it).
- RC-4: The destructive warnings, the Review summaries and the password rules are unchanged.
- RC-5: The specs that mention the typed name are amended: AC-32 (cargar-padrones), CL-30 and CL-47 (cargar-localidades), AP-18, AP-31 and AP-91 (actualizar-padron) and the unit-territorial equivalents say the password only. The wiki pages of the four jobs stop mentioning typing the table name.
- RC-6: The locality MDM job (branch `feat/routine-jobs-antel-locality-mdm`, not on `main`) gets the same change when that branch is merged; it is not touched here.

## Out of scope

- Server-side validation (none exists), the password rules, the MDM branch (RC-6).

## Acceptance criteria count

RC-1 to RC-6 (6 criteria).
