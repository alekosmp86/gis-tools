import { spawn } from "node:child_process";
import { statfs } from "node:fs/promises";
import { FAKE_STAGE_MS, PIPELINE_ENV_VAR } from "../constants";
import { isPidAlive } from "../job/liveness.ts";
import type { PidAliveFn } from "../job/liveness.ts";
import { defaultRootDir } from "../job/layout.ts";
import type { FakeConfig } from "../job/fakePipeline.ts";
import { createSweeper } from "./sweeper";
import type { Sweeper } from "./sweeper";
import { PgShpPlanRepository } from "./PgShpPlanRepository";
import type { ShpPlanRepository } from "./ShpPlanRepository";
import type { SpawnProcessFn } from "./spawnTypes";

export type PipelineMode = "fake" | "real";

export interface ShpHandlerDependencies {
  readonly rootDir?: string;
  readonly repository?: ShpPlanRepository;
  readonly spawnProcess?: SpawnProcessFn;
  readonly pipelineMode?: PipelineMode;
  readonly fakeConfig?: FakeConfig;
  readonly now?: () => number;
  readonly isPidAlive?: PidAliveFn;
  readonly killProcess?: (pid: number) => void;
  /** Free bytes on the volume that holds `rootDir`. */
  readonly freeBytes?: (dir: string) => Promise<number>;
}

export interface ShpBaseContext {
  readonly rootDir: string;
  readonly repository: ShpPlanRepository;
  readonly spawnProcess: SpawnProcessFn;
  readonly pipelineMode: PipelineMode;
  readonly fakeConfig: FakeConfig;
  readonly now: () => number;
  readonly isPidAlive: PidAliveFn;
  readonly killProcess: (pid: number) => void;
  readonly freeBytes: (dir: string) => Promise<number>;
}

export interface ShpContext extends ShpBaseContext {
  readonly sweeper: Sweeper;
}

async function freeBytesOf(dir: string): Promise<number> {
  const stats = await statfs(dir);
  return Number(stats.bavail) * Number(stats.bsize);
}

function killHard(pid: number): void {
  process.kill(pid, "SIGKILL");
}

/** Read once, when the handlers are created. */
function pipelineModeFromEnv(): PipelineMode {
  return process.env[PIPELINE_ENV_VAR] === "fake" ? "fake" : "real";
}

export function createShpContext(dependencies: ShpHandlerDependencies = {}): ShpContext {
  const base: ShpBaseContext = {
    rootDir: dependencies.rootDir ?? defaultRootDir(),
    repository: dependencies.repository ?? new PgShpPlanRepository(),
    spawnProcess: dependencies.spawnProcess ?? ((command, args, options) => spawn(command, args, options)),
    pipelineMode: dependencies.pipelineMode ?? pipelineModeFromEnv(),
    fakeConfig: dependencies.fakeConfig ?? { stageMs: FAKE_STAGE_MS },
    now: dependencies.now ?? Date.now,
    isPidAlive: dependencies.isPidAlive ?? isPidAlive,
    killProcess: dependencies.killProcess ?? killHard,
    freeBytes: dependencies.freeBytes ?? freeBytesOf,
  };
  return { ...base, sweeper: createSweeper(base) };
}
