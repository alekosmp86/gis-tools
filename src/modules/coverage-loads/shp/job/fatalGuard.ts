import type { PipelineOutcome } from "./pipeline.ts";
import { errorText } from "./scrub.ts";
import type { Scrubber } from "./scrub.ts";

export interface Guard {
  readonly promise: Promise<PipelineOutcome>;
  dispose(): void;
}

/** Turns an uncaught exception / unhandled rejection into a FAILED outcome so the status still gets written. */
export function installFatalGuard(scrub: Scrubber): Guard {
  let resolveFatal: (outcome: PipelineOutcome) => void = () => undefined;
  const promise = new Promise<PipelineOutcome>((resolve) => {
    resolveFatal = resolve;
  });
  const handler = (error: unknown): void => {
    resolveFatal({ kind: "FAILED", error: { code: "JOB_UNCAUGHT", message: scrub(errorText(error, "Error no controlado en el proceso de carga.")) } });
  };
  process.on("uncaughtException", handler);
  process.on("unhandledRejection", handler);
  return {
    promise,
    dispose() {
      process.off("uncaughtException", handler);
      process.off("unhandledRejection", handler);
    },
  };
}
