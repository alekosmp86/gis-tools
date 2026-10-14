import { PairingMethod } from "@/core/types/comparison";
import { GIS_PRECISION } from "@/core/constants/gisConstants";
import { geometryDistance, prepareGeometry, type PreparedGeometry } from "./GeometryDistance";

export const MAX_PAIRING_CANDIDATES = 40_000;
const NO_GEOMETRY_TOKEN = "<no-geometry>";

type RowPairMethod =
  | typeof PairingMethod.EXACT
  | typeof PairingMethod.GEOMETRY
  | typeof PairingMethod.ELIMINATION;

export interface PairingRow {
  index: number;
  geometry: unknown;
  signature: string;
  attributeSignature?: string;
  values: readonly unknown[];
}

export interface PairedRows {
  dbIndex: number;
  fileIndex: number;
  method: RowPairMethod;
  distance?: number;
}

export interface KeyGroupPairingOptions {
  areEquivalent: (dbValue: unknown, fileValue: unknown) => boolean;
  maxCandidates: number;
}

export interface KeyGroupPairingResult {
  pairs: PairedRows[];
  unpairedDb: number[];
  unpairedFile: number[];
  dbTwinExtras: number[];
  fileTwinExtras: number[];
  ambiguousDb: number[];
  ambiguousFile: number[];
  cappedSkipped: boolean;
}

interface GeometryRow {
  row: PairingRow;
  shape: PreparedGeometry;
}

interface PairingEdge {
  quantizedDistance: number;
  differenceCount: number;
  distance: number;
  dbIndex: number;
  fileIndex: number;
}

function byIndex(first: PairingRow, second: PairingRow): number {
  return first.index - second.index;
}

function ascending(first: number, second: number): number {
  return first - second;
}

/**
 * Coordinates rounded to the comparison precision so geometries equal within tolerance share
 * the same fingerprint.
 */
export function fingerprintRoundedGeometry(geometry: unknown): string {
  if (geometry === undefined || geometry === null) return NO_GEOMETRY_TOKEN;
  try {
    return (
      JSON.stringify(geometry, (_key, value) =>
        typeof value === "number" ? Math.round(value * GIS_PRECISION.COMPARISON_FACTOR) : value
      ) ?? NO_GEOMETRY_TOKEN
    );
  } catch {
    return NO_GEOMETRY_TOKEN;
  }
}

function collapseTwins(rows: PairingRow[]): {
  representatives: PairingRow[];
  extras: number[];
} {
  const representatives: PairingRow[] = [];
  const extras: number[] = [];
  const seenSignatures = new Set<string>();
  for (const row of [...rows].sort(byIndex)) {
    if (seenSignatures.has(row.signature)) {
      extras.push(row.index);
    } else {
      seenSignatures.add(row.signature);
      representatives.push(row);
    }
  }
  return { representatives, extras };
}

interface SignaturePairing {
  pairs: PairedRows[];
  remainingDb: PairingRow[];
  remainingFile: PairingRow[];
}

function pairBySignature(
  dbReps: PairingRow[],
  fileReps: PairingRow[],
  signatureOf: (row: PairingRow) => string | undefined
): SignaturePairing {
  const sortedFile = [...fileReps].sort(byIndex);
  const fileBySignature = new Map<string, PairingRow>();
  for (const fileRow of sortedFile) {
    const signature = signatureOf(fileRow);
    if (signature !== undefined && !fileBySignature.has(signature)) {
      fileBySignature.set(signature, fileRow);
    }
  }
  const pairs: PairedRows[] = [];
  const pairedFile = new Set<number>();
  const remainingDb: PairingRow[] = [];
  for (const dbRow of [...dbReps].sort(byIndex)) {
    const signature = signatureOf(dbRow);
    const fileRow = signature === undefined ? undefined : fileBySignature.get(signature);
    if (fileRow && !pairedFile.has(fileRow.index)) {
      pairedFile.add(fileRow.index);
      pairs.push({ dbIndex: dbRow.index, fileIndex: fileRow.index, method: PairingMethod.EXACT });
    } else {
      remainingDb.push(dbRow);
    }
  }
  return {
    pairs,
    remainingDb,
    remainingFile: sortedFile.filter((row) => !pairedFile.has(row.index)),
  };
}

function hasSideWithoutGeometry(dbRows: PairingRow[], fileRows: PairingRow[]): boolean {
  return toGeometryRows(dbRows).length === 0 || toGeometryRows(fileRows).length === 0;
}

function pairExactSignatures(dbReps: PairingRow[], fileReps: PairingRow[]): SignaturePairing {
  const full = pairBySignature(dbReps, fileReps, (row) => row.signature);
  if (
    full.remainingDb.length === 0 ||
    full.remainingFile.length === 0 ||
    !hasSideWithoutGeometry(full.remainingDb, full.remainingFile)
  ) {
    return full;
  }
  const attributeOnly = pairBySignature(
    full.remainingDb,
    full.remainingFile,
    (row) => row.attributeSignature
  );
  return { ...attributeOnly, pairs: [...full.pairs, ...attributeOnly.pairs] };
}

function toGeometryRows(rows: PairingRow[]): GeometryRow[] {
  const geometryRows: GeometryRow[] = [];
  for (const row of rows) {
    const shape = prepareGeometry(row.geometry);
    if (shape) geometryRows.push({ row, shape });
  }
  return geometryRows;
}

function countDifferences(
  dbRow: PairingRow,
  fileRow: PairingRow,
  areEquivalent: KeyGroupPairingOptions["areEquivalent"]
): number {
  let differenceCount = 0;
  for (let fieldIndex = 0; fieldIndex < dbRow.values.length; fieldIndex++) {
    if (!areEquivalent(dbRow.values[fieldIndex], fileRow.values[fieldIndex])) differenceCount++;
  }
  return differenceCount;
}

function compareEdges(first: PairingEdge, second: PairingEdge): number {
  return (
    first.quantizedDistance - second.quantizedDistance ||
    first.differenceCount - second.differenceCount ||
    first.dbIndex - second.dbIndex ||
    first.fileIndex - second.fileIndex
  );
}

function buildEdges(
  dbRows: GeometryRow[],
  fileRows: GeometryRow[],
  areEquivalent: KeyGroupPairingOptions["areEquivalent"]
): PairingEdge[] {
  const edges: PairingEdge[] = [];
  for (const dbEntry of dbRows) {
    for (const fileEntry of fileRows) {
      const distance = geometryDistance(dbEntry.shape, fileEntry.shape);
      if (!Number.isFinite(distance)) continue;
      edges.push({
        quantizedDistance: Math.round(distance * GIS_PRECISION.COMPARISON_FACTOR),
        differenceCount: countDifferences(dbEntry.row, fileEntry.row, areEquivalent),
        distance,
        dbIndex: dbEntry.row.index,
        fileIndex: fileEntry.row.index,
      });
    }
  }
  return edges;
}

function pairByGeometry(
  dbRows: GeometryRow[],
  fileRows: GeometryRow[],
  areEquivalent: KeyGroupPairingOptions["areEquivalent"]
): PairedRows[] {
  const edges = buildEdges(dbRows, fileRows, areEquivalent).sort(compareEdges);
  const usedDb = new Set<number>();
  const usedFile = new Set<number>();
  const pairs: PairedRows[] = [];
  const maxPairs = Math.min(dbRows.length, fileRows.length);
  for (const edge of edges) {
    if (pairs.length >= maxPairs) break;
    if (usedDb.has(edge.dbIndex) || usedFile.has(edge.fileIndex)) continue;
    usedDb.add(edge.dbIndex);
    usedFile.add(edge.fileIndex);
    pairs.push({
      dbIndex: edge.dbIndex,
      fileIndex: edge.fileIndex,
      method: PairingMethod.GEOMETRY,
      distance: edge.distance,
    });
  }
  return pairs;
}

function withoutPaired(rows: PairingRow[], pairedIndexes: Set<number>): PairingRow[] {
  return rows.filter((row) => !pairedIndexes.has(row.index));
}

function resolveRemainder(
  remainingDb: PairingRow[],
  remainingFile: PairingRow[],
  capped: boolean
): Pick<
  KeyGroupPairingResult,
  "pairs" | "unpairedDb" | "unpairedFile" | "ambiguousDb" | "ambiguousFile" | "cappedSkipped"
> {
  const dbIndexes = remainingDb.map((row) => row.index);
  const fileIndexes = remainingFile.map((row) => row.index);
  const base = {
    pairs: [] as PairedRows[],
    unpairedDb: [] as number[],
    unpairedFile: [] as number[],
    ambiguousDb: [] as number[],
    ambiguousFile: [] as number[],
    cappedSkipped: false,
  };
  if (dbIndexes.length === 0 || fileIndexes.length === 0) {
    return { ...base, unpairedDb: dbIndexes, unpairedFile: fileIndexes };
  }
  if (capped) {
    return { ...base, ambiguousDb: dbIndexes, ambiguousFile: fileIndexes, cappedSkipped: true };
  }
  if (dbIndexes.length === 1 && fileIndexes.length === 1) {
    return {
      ...base,
      pairs: [
        { dbIndex: dbIndexes[0], fileIndex: fileIndexes[0], method: PairingMethod.ELIMINATION },
      ],
    };
  }
  return { ...base, ambiguousDb: dbIndexes, ambiguousFile: fileIndexes };
}

function pairRemainingByGeometry(
  remainingDb: PairingRow[],
  remainingFile: PairingRow[],
  options: KeyGroupPairingOptions
): { pairs: PairedRows[]; capped: boolean } {
  const dbGeometryRows = toGeometryRows(remainingDb);
  const fileGeometryRows = toGeometryRows(remainingFile);
  const maxCandidates = options.maxCandidates;
  if (dbGeometryRows.length * fileGeometryRows.length > maxCandidates) {
    return { pairs: [], capped: true };
  }
  return {
    pairs: pairByGeometry(dbGeometryRows, fileGeometryRows, options.areEquivalent),
    capped: false,
  };
}

export function pairKeyGroup(
  dbRows: PairingRow[],
  fileRows: PairingRow[],
  options: KeyGroupPairingOptions
): KeyGroupPairingResult {
  const dbSide = collapseTwins(dbRows);
  const fileSide = collapseTwins(fileRows);
  const exact = pairExactSignatures(dbSide.representatives, fileSide.representatives);

  let geometryPairs: PairedRows[] = [];
  let capped = false;
  if (exact.remainingDb.length > 0 && exact.remainingFile.length > 0) {
    ({ pairs: geometryPairs, capped } = pairRemainingByGeometry(
      exact.remainingDb,
      exact.remainingFile,
      options
    ));
  }

  const pairedDb = new Set(geometryPairs.map((pair) => pair.dbIndex));
  const pairedFile = new Set(geometryPairs.map((pair) => pair.fileIndex));
  const remainder = resolveRemainder(
    withoutPaired(exact.remainingDb, pairedDb),
    withoutPaired(exact.remainingFile, pairedFile),
    capped
  );

  return {
    ...remainder,
    pairs: [...exact.pairs, ...geometryPairs, ...remainder.pairs].sort(
      (first, second) => first.dbIndex - second.dbIndex
    ),
    dbTwinExtras: dbSide.extras.sort(ascending),
    fileTwinExtras: fileSide.extras.sort(ascending),
  };
}
