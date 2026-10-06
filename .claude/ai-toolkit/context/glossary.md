# Glossary

Evidence: identifier grep across `src/**/*.ts(x)`. Domain is Uruguayan cadastral/GIS data. UI-facing strings are Spanish (per `AGENTS.md` "Language & Localization"); code identifiers mix English scaffolding with Spanish domain nouns.

| Term | Seen as | Meaning (inferred from usage) |
|---|---|---|
| `suid` | `suidResolver`, `suidColumns`, `suidKey`, `suidMap`, `suidMappingRef`, `suidColsList`, `suidFieldDescriptors` | Spatial/structure unique identifier column(s) used to map and reconcile records across sources during sync/comparison tools |
| `padron` | `padron` (20 occurrences) | Cadastral parcel registry number (standard Uruguayan term) |
| `departamento(s)` | `departamentos`, `departamento` | Uruguay's first-level administrative division (province-equivalent); surfaced in the address-dedup module's connection/profile picker |
| `lote(s)` | `lote`, `lotes` | Land lot/parcel |
| `master` / `master-reference` | address-dedup module | The canonical/reference record a duplicate group is reconciled against |

## Open questions
- No single cross-module definition file for these terms was found; each tool/module defines them locally in its own types/domain layer. Toolkit does not propose consolidating them into a shared glossary file — that would cut against the modular-monolith invariant ("no module may import another module") unless the term is genuinely cross-module (e.g. `padron`, `suid`, `departamento` do recur across db-sync tools and address-dedup). Left as an open question for the human: worth a shared `src/core/types/` glossary type, or is recurrence coincidental?
