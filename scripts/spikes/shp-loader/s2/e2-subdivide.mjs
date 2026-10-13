// SPIKE S2 wrapper: E2 phase A (load + subdivide). Usage: node e2-subdivide.mjs --file <path.shp> [--compare cobertura5g|nbiot] [--batch N] [--chunk-mb 8] [--dry-run]
// Temp tables vanish with the session, so earlier phases this experiment depends on are re-run first.
import { runCli } from './s2-steps.mjs';
await runCli('e2', ['e2']);
