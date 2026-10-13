/**
 * Detached job process. Usage:
 *   node --disable-warning=ExperimentalWarning shp/job/jobEntry.ts [--root <dir>] < config.json
 *   node --disable-warning=ExperimentalWarning shp/job/jobEntry.ts --self-test
 * Reads ALL of stdin (one JSON config, secrets included) before doing anything else. Nothing from the
 * config is ever printed. Exit: 0 succeeded, 1 failed, 2 cancelled, 3 bad config.
 */
import { EXIT_CODE } from "./constants.ts";
import { parseJobConfig } from "./jobConfig.ts";
import { defaultRootDir } from "./layout.ts";
import { runJob } from "./runJob.ts";
import { runSelfTest } from "./selfTest.ts";

const ROOT_FLAG = "--root";
const SELF_TEST_FLAG = "--self-test";

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function rootFromArgs(args: readonly string[]): string | undefined {
  const index = args.indexOf(ROOT_FLAG);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(args: readonly string[]): Promise<number> {
  if (args.includes(SELF_TEST_FLAG)) {
    const ok = await runSelfTest();
    process.stdout.write(ok ? "self-test ok\n" : "self-test failed\n");
    return ok ? EXIT_CODE.SUCCEEDED : EXIT_CODE.FAILED;
  }

  const parsed = parseJobConfig(await readAllStdin());
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n`);
    return EXIT_CODE.BAD_CONFIG;
  }

  const rootDir = parsed.config.rootDir ?? rootFromArgs(args) ?? defaultRootDir();
  const code = await runJob(parsed.config, { rootDir });
  if (code === EXIT_CODE.BAD_CONFIG) process.stderr.write("La carga no pudo iniciarse: estado inexistente o no READY.\n");
  return code;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  () => {
    process.stderr.write("Error inesperado en el proceso de carga.\n");
    process.exit(EXIT_CODE.FAILED);
  }
);
