// SPIKE S2 wrapper: E7 verification (E2+E3+E4 then compare). Usage: node e7-verify.mjs --file <path.shp> [--compare cobertura5g|nbiot] [--batch N] [--chunk-mb 8] [--dry-run]
// Temp tables vanish with the session, so earlier phases this experiment depends on are re-run first.
import { runCli } from './s2-steps.mjs';
await runCli('e7', ['e2','e3','e4','e7']);
