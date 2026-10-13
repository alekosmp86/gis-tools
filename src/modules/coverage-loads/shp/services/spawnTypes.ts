import type { SpawnOptions } from "node:child_process";

/** The slice of a child process the launcher uses; a test fake implements it. */
export interface ChildLike {
  readonly pid?: number;
  readonly stdin: {
    write(chunk: string): unknown;
    end(): unknown;
    on(event: "error", listener: () => void): unknown;
  } | null;
  unref(): void;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "exit", listener: (code: number | null) => void): unknown;
}

export type SpawnProcessFn = (command: string, args: string[], options: SpawnOptions) => ChildLike;
