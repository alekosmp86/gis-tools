// SPIKE S2 wrapper: E1..E5 and E7 in ONE session (E6 is separate). Usage: node run-all.mjs --file <path.shp> [--compare cobertura5g|nbiot] [--batch N] [--chunk-mb 8] [--dry-run]
// Temp tables vanish with the session, so earlier phases this experiment depends on are re-run first.
import { runCli } from './s2-steps.mjs';
await runCli('run-all', ['e1','e2','e3','e4','e5','e7']);
