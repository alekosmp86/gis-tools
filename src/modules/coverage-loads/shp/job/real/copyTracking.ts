import type { Writable } from "node:stream";
import { COPY_ABORT_WAIT_MS } from "../constants.ts";

export interface CopyTracker {
  /** Settles when the server has accepted the whole COPY (`finish`), or rejects with the stream's error. */
  readonly finished: Promise<void>;
  /** The error the stream itself reported (a server-side failure), if any. */
  failure(): Error | null;
}

/** Keeps an `error` listener on the stream for its whole life: a late error can never be uncaught. */
export function trackCopy(copy: Writable): CopyTracker {
  let reported: Error | null = null;
  const finished = new Promise<void>((resolve, reject) => {
    copy.once("finish", resolve);
    copy.on("error", (error: Error) => {
      reported ??= error;
      reject(error);
    });
  });
  finished.catch(() => undefined);
  return { finished, failure: () => reported };
}

function waitForClose(copy: Writable): Promise<void> {
  return new Promise<void>((resolve) => {
    if (copy.closed) resolve();
    else copy.once("close", () => resolve());
  });
}

function delay(ms: number): { promise: Promise<void>; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

/**
 * Tears a half-written COPY down so the connection can be reused. When the stream already failed
 * (the server aborted it) there is nothing to send: calling `destroy` then would hit a released
 * connection inside pg-copy-streams.
 */
export async function abortCopy(copy: Writable, tracker: CopyTracker, reason: Error): Promise<void> {
  if (tracker.failure() !== null || copy.destroyed) return;
  const timeout = delay(COPY_ABORT_WAIT_MS);
  try {
    copy.destroy(reason);
    await Promise.race([waitForClose(copy), timeout.promise]);
  } catch {
    return;
  } finally {
    timeout.cancel();
  }
}
