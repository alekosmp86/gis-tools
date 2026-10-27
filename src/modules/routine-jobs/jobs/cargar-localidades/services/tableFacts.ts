import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { physicalColumn, qualifiedName, type TableLayout } from "../../actualizar-padron/domain/layouts";
import { readRelationKind, readTriggerAndRuleFacts } from "../../actualizar-padron/services/catalogFacts";
import { STAGING_LOCALITY_COLUMN } from "../constants";
import type { SpatialRefFacts, TargetStructureFacts } from "../domain/targetIssues";

interface TableName {
  schema: string;
  table: string;
}

const ID_SEQUENCE_SQL =
  "SELECT pg_catalog.pg_get_serial_sequence(format('%I.%I', $1::text, $2::text), $3::text) AS sequence_name";

const INHERITANCE_SQL = `SELECT
  EXISTS (SELECT 1 FROM pg_catalog.pg_inherits WHERE inhparent = format('%I.%I', $1::text, $2::text)::regclass) AS has_children,
  EXISTS (SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid = format('%I.%I', $1::text, $2::text)::regclass) AS is_child`;

const SPATIAL_REF_SQL = "SELECT srtext, proj4text FROM spatial_ref_sys WHERE srid = $1";

const textOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

export async function readIdSequence(
  session: CatalogQuerySession,
  layout: TableName,
  idColumn: string
): Promise<string | null> {
  const result = await session.query(ID_SEQUENCE_SQL, [layout.schema, layout.table, idColumn]);
  return textOrNull(result.rows[0]?.sequence_name);
}

async function readInheritance(
  session: CatalogQuerySession,
  layout: TableName
): Promise<{ hasChildren: boolean; isChild: boolean }> {
  const result = await session.query(INHERITANCE_SQL, [layout.schema, layout.table]);
  const row = result.rows[0] ?? {};
  return { hasChildren: row.has_children === true, isChild: row.is_child === true };
}

export async function readSpatialRef(session: CatalogQuerySession, srid: number): Promise<SpatialRefFacts | undefined> {
  const result = await session.query(SPATIAL_REF_SQL, [srid]);
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return { srtext: textOrNull(row.srtext), proj4text: textOrNull(row.proj4text) };
}

function buildUnsupportedSridSql(staging: TableLayout): string {
  const geometry = `l.${physicalColumn(staging, STAGING_LOCALITY_COLUMN.GEOM)}`;
  return [
    `SELECT count(*) AS "unsupported" FROM ${qualifiedName(staging)} AS l`,
    `WHERE ${geometry} IS NOT NULL AND (ST_SRID(${geometry}) = 0`,
    `OR NOT EXISTS (SELECT 1 FROM spatial_ref_sys AS s WHERE s.srid = ST_SRID(${geometry})))`,
  ].join(" ");
}

export async function readUnsupportedSridCount(session: CatalogQuerySession, staging: TableLayout): Promise<number> {
  const result = await session.query(buildUnsupportedSridSql(staging));
  return Number(result.rows[0]?.unsupported ?? 0);
}

export async function readTargetStructure(
  session: CatalogQuerySession,
  layout: TableName,
  label: string
): Promise<TargetStructureFacts> {
  // One pg client: catalog reads are awaited in turn, so they never overlap.
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const relkind = await readRelationKind(session, layout);
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const inheritance = await readInheritance(session, layout);
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const facts = await readTriggerAndRuleFacts(session, layout);
  return { label, relkind, ...inheritance, facts };
}
