import { describe, expect, it } from "vitest";
import { buildEjesAnalysisSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/analysisSql";
import { readAnalysis, readAnalysisForLoad } from "@/modules/routine-jobs/jobs/ejes-calles/services/readEjesAnalysis";
import type { RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import { ejesLayouts } from "./ejesFixtures";

const WORK_MEM_SQL = "SET LOCAL work_mem = '64MB'";

const recordingSession = (log: string[]): RunSession => ({
  async query(sql: string) {
    log.push(sql);
    return { rows: [] };
  },
  async close() {},
});

describe("readEjesAnalysis work memory (EJES analysis)", () => {
  it("should send SET LOCAL work_mem before the analysis query in readAnalysis", async () => {
    const log: string[] = [];

    await readAnalysis(recordingSession(log), ejesLayouts());

    expect(log).toEqual([WORK_MEM_SQL, buildEjesAnalysisSql(ejesLayouts(), undefined, [])]);
  });

  it("should send SET LOCAL work_mem immediately before the analysis query in readAnalysisForLoad", async () => {
    const log: string[] = [];

    await readAnalysisForLoad(recordingSession(log), ejesLayouts(), []);

    expect(log.slice(-2)[0]).toBe(WORK_MEM_SQL);
    expect(log.slice(-1)[0]).toMatch(/^WITH /);
    expect(log.filter((sql) => sql === WORK_MEM_SQL)).toHaveLength(1);
  });
});
