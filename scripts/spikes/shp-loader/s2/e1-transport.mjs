// SPIKE S2 wrapper: E1 transport of the giant geometry. Usage: node e1-transport.mjs --file <path.shp> [--compare cobertura5g|nbiot] [--batch N] [--chunk-mb 8] [--dry-run]
// Temp tables vanish with the session, so earlier phases this experiment depends on are re-run first.
import { runCli } from './s2-steps.mjs';
await runCli('e1', ['e1']);
