import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { quoteIdentifier } from "@/core/services/sqlStatements";
import { physicalColumn, qualifiedName, type TableLayout } from "../actualizar-padron/domain/layouts";
import { sequenceReferenceOf, type SequenceReference } from "../actualizar-padron/domain/sequenceReference";
import { readRelationKind, readTriggerAndRuleFacts } from "../actualizar-padron/services/catalogFacts";
import type { SpatialRefFacts, TargetStructureFacts } from "./targetIssues";

interface TableName {
  schema: string;
  table: string;
}

const ID_SEQUENCE_SQL =
  "SELECT pg_catalog.pg_get_serial_sequence(format('%I.%I', $1::text, $2::text), $3::text) AS sequence_name";

const DEFAULT_SEQUENCE_SQL = `SELECT format('%I.%I', n.nspname, c.relname) AS sequence_name
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.oid = to_regclass($1::text) AND c.relkind = 'S'`;

const INHERITANCE_SQL = `SELECT
  EXISTS (SELECT 1 FROM pg_catalog.pg_inherits WHERE inhparent = format('%I.%I', $1::text, $2::text)::regclass) AS has_children,
  EXISTS (SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid = format('%I.%I', $1::text, $2::text)::regclass) AS is_child`;

const SPATIAL_REF_SQL = "SELECT srtext, proj4text FROM spatial_ref_sys WHERE srid = $1";

const textOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

const quotedSequenceOf = (reference: SequenceReference): string =>
  reference.schema === undefined
    ? quoteIdentifier(reference.name)
    : `${quoteIdentifier(reference.schema)}.${quoteIdentifier(reference.name)}`;

async function readOwnedSequence(session: CatalogQuerySession, layout: TableName, idColumn: string): Promise<string | null> {
  const result = await session.query(ID_SEQUENCE_SQL, [layout.schema, layout.table, idColumn]);
  return textOrNull(result.rows[0]?.sequence_name);
}

async function readDefaultSequence(session: CatalogQuerySession, columnDefault: string | null): Promise<string | null> {
  const reference = sequenceReferenceOf(columnDefault);
  if (reference === undefined) return null;
  const result = await session.query(DEFAULT_SEQUENCE_SQL, [quotedSequenceOf(reference)]);
  return textOrNull(result.rows[0]?.sequence_name);
}

export async function readIdSequence(
  session: CatalogQuerySession,
  layout: TableName,
  idColumn: string,
  columnDefault: string | null
): Promise<string | null> {
  return (await readOwnedSequence(session, layout, idColumn)) ?? (await readDefaultSequence(session, columnDefault));
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

function buildUnsupportedSridSql(staging: TableLayout, geometryLogical: string): string {
  const geometry = `l.${physicalColumn(staging, geometryLogical)}`;
  return [
    `SELECT count(*) AS "unsupported" FROM ${qualifiedName(staging)} AS l`,
    `WHERE ${geometry} IS NOT NULL AND (ST_SRID(${geometry}) = 0`,
    `OR NOT EXISTS (SELECT 1 FROM spatial_ref_sys AS s WHERE s.srid = ST_SRID(${geometry})))`,
  ].join(" ");
}

export async function readUnsupportedSridCount(
  session: CatalogQuerySession,
  staging: TableLayout,
  geometryLogical: string
): Promise<number> {
  const result = await session.query(buildUnsupportedSridSql(staging, geometryLogical));
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
