import { appendFile } from "node:fs/promises";
import type { Scrubber } from "./scrub.ts";
import type { LogLevel } from "./types.ts";

export interface JobLog {
  write(level: LogLevel, message: string): void;
  /** Resolves once every queued line is on disk. */
  close(): Promise<void>;
}

const LINE_BREAKS = /\r?\n/g;

/** Appends `ISO LEVEL message` lines, scrubbed, one durable append per line so a crash keeps them. */
export function createJobLog(file: string, scrub: Scrubber, now: () => number = Date.now): JobLog {
  let chain: Promise<void> = Promise.resolve();
  return {
    write(level, message) {
      const line = `${new Date(now()).toISOString()} ${level} ${scrub(message).replace(LINE_BREAKS, " | ")}\n`;
      chain = chain.then(() => appendFile(file, line, "utf8")).catch(() => undefined);
    },
    close() {
      return chain;
    },
  };
}
