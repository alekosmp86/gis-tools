// SPIKE S2 wrapper: E3 phase B (E2 + batched repair). Usage: node e3-repair.mjs --file <path.shp> [--compare cobertura5g|nbiot] [--batch N] [--chunk-mb 8] [--dry-run]
// Temp tables vanish with the session, so earlier phases this experiment depends on are re-run first.
import { runCli } from './s2-steps.mjs';
await runCli('e3', ['e2','e3']);
