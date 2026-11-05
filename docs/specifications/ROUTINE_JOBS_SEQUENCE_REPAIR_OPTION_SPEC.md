# Routine jobs: optional adjustment of the id sequences (SQ-1 to SQ-9)

## Context

Cargar localidades, Unidad territorial and Actualizar padrón always run `setval(seq, GREATEST(max(id) + 1, last_value + 1), false)` on the target id sequence(s) before inserting, and their preflight ("Validar tablas de destino") requires the `UPDATE` privilege on those sequences. On preprod the user (`icgeousr`) has `USAGE` but not `UPDATE` on `carto.cadastral_locality_id_seq`, `carto.padron_id_seq` and others, and the privilege cannot be requested. `nextval` only needs `USAGE` (or `UPDATE`), so the adjustment can be made optional, as `cargar-padrones` already does with "Reiniciar secuencias del destino".

Scope: the three jobs above, in this branch. The locality MDM job (feat/routine-jobs-antel-locality-mdm, not on main) gets the same option once that branch is merged.

## Behaviour

- SQ-1: The start request of each of the three jobs carries a boolean `repairSequences`. A missing or non-boolean value is a 400, as for the other boolean options.
- SQ-2: `repairSequences = true`: unchanged. The adjustment step(s) run and the preflight requires `UPDATE` on each id sequence it adjusts (target and, where the job adjusts it, the address master).
- SQ-3: `repairSequences = false`: no `setval` is issued, the planned step list omits the adjustment step(s) (progress and checklist stay consistent), and the preflight requires `USAGE` or `UPDATE` on those sequences instead of `UPDATE` (the state check of SQ-5 is separate).
- SQ-4: The table privilege checks (SELECT, INSERT, UPDATE) and every other preflight check are unchanged in both modes.
- SQ-5: With `repairSequences = false`, the sequence state check (next value = `last_value + 1`, or 1 when never called, against the maximum id of its table) is not a preflight check: it runs after the classification and only for a sequence whose table the run will insert rows into (rows to insert > 0 for that table; for the address master, address masters to create > 0). A run that inserts nothing into a table never fails for that table's sequence. When rows will be inserted and the next value is not above the maximum id, a real run fails before the first write with a Spanish message that names the sequence and the table and says to activate "Ajustar secuencias de destino"; the analysis (dry run) does not fail: it reports the same text as a warning. A sequence already above the maximum id passes. Reading the sequence state requires `USAGE` (or `SELECT`); a failure to read it is reported as an issue (warning in the analysis), not ignored.
- SQ-6: The missing-`UPDATE` message of SQ-2 also says that the option can be deactivated.
- SQ-7: The analysis (dry run) follows the same rules, except that the SQ-5 finding is a warning; the option does not change what a dry run rolls back. A dry run with the option on keeps today's behaviour (`setval` is not transactional).

## Client

- SQ-8: Each of the three wizards has a checkbox "Ajustar secuencias de destino", unchecked by default, with a hint that it needs `UPDATE` on the sequences and may be left off when the sequence is already ahead of the ids. The Review step shows it as Sí / No, and it travels in the start request (SQ-1).

## Documentation

- SQ-9: The wiki pages of the three jobs describe the option, the privilege each mode needs, and the SQ-5 error, and `solucion-de-problemas` lists the "No tiene privilegio UPDATE sobre la secuencia" message with the way out.

## Out of scope

- The locality MDM job (see Context), the `cargar-padrones` option (exists), changing sequence ownership or grants.

## Acceptance criteria count

SQ-1 to SQ-9 (9 criteria).
