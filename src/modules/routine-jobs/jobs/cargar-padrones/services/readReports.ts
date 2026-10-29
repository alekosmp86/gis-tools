import type { RunSession } from "../types";
import { PADRON_UNIT, type PadronUnit } from "../constants";
import {
  buildAmbiguousLocalityCodesSql,
  buildConflictSamplesSql,
  buildGeometryReportSql,
  type LoadOptions,
  type SourceLayout,
} from "../domain/loadSql";
import type { AmbiguousLocalityCode, AttributeConflictSample, LoadOutput, TypeReport } from "../types";
import type { ResolvedLayouts } from "./resolveLayouts";

export interface InsertedCounts {
  rural: number;
  urbano: number;
}

const numberOf = (row: Record<string, unknown>, key: string): number => Number(row[key] ?? 0);

const stringsOf = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

const scalarOf = (value: unknown): string | number | null => {
  if (typeof value === "string" || typeof value === "number") return value;
  return value == null ? null : String(value);
};

const toConflictSample = (row: Record<string, unknown>): AttributeConflictSample => ({
  key: String(row.key),
  column: String(row.column),
  values: stringsOf(row.values),
});

const toAmbiguousCode = (row: Record<string, unknown>): AmbiguousLocalityCode => ({
  coddepto: scalarOf(row.coddepto),
  codloccat: scalarOf(row.codloccat),
  nomdepto: row.nomdepto == null ? null : String(row.nomdepto),
  nomloccat: stringsOf(row.nomloccat),
});

function toTypeReport(summary: Record<string, unknown>, samples: Array<Record<string, unknown>>, inserted: number): TypeReport {
  const rowsRead = numberOf(summary, "rowsRead");
  const groups = numberOf(summary, "groups");
  const noGeometry = numberOf(summary, "noGeometry");
  const nullKeyRows = numberOf(summary, "nullKeyRows");
  return {
    rowsRead,
    groups,
    rowsMerged: rowsRead - nullKeyRows - noGeometry - groups,
    repaired: numberOf(summary, "repaired"),
    insertedInvalid: numberOf(summary, "insertedInvalid"),
    repairedInUnion: numberOf(summary, "repairedInUnion"),
    noGeometry,
    nullKeyRows,
    attributeConflicts: numberOf(summary, "attributeConflicts"),
    attributeConflictSamples: samples.map(toConflictSample),
    inserted,
  };
}

async function readUnitReport(
  session: RunSession,
  unit: PadronUnit,
  layout: SourceLayout,
  options: LoadOptions,
  inserted: number
): Promise<TypeReport> {
  const summary = await session.query(buildGeometryReportSql(unit, layout, options));
  const samples = await session.query(buildConflictSamplesSql(unit, layout, { repair: options.repair }));
  return toTypeReport(summary.rows[0] ?? {}, samples.rows, inserted);
}

export async function readLoadOutput(
  session: RunSession,
  layouts: ResolvedLayouts,
  options: LoadOptions,
  inserted: InsertedCounts
): Promise<LoadOutput> {
  // One pg client: report queries must not overlap.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const rural = await readUnitReport(session, PADRON_UNIT.RURAL, layouts.rural, options, inserted.rural);
  // One pg client: report queries must not overlap.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const urbano = await readUnitReport(session, PADRON_UNIT.URBANO, layouts.urbano, options, inserted.urbano);
  // One pg client: report queries must not overlap.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const codes = await session.query(buildAmbiguousLocalityCodesSql(layouts.urbano));
  return {
    rural,
    urbano,
    ambiguousLocalityCodes: codes.rows.map(toAmbiguousCode),
    ambiguousLocalityTotal: numberOf(codes.rows[0] ?? {}, "total"),
  };
}
