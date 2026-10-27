import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { RELATION_FACT_KIND, RETURN_RULE_NAME, type RelationFactKind } from "../constants";
import type { TableLayout } from "../domain/layouts";

type TableName = Pick<TableLayout, "schema" | "table">;

export interface RelationFact {
  kind: RelationFactKind;
  name: string;
}

const RELATION_KIND_SQL = `SELECT c.relkind::text AS relkind
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2`;

const IDENTITY_COLUMNS_SQL = `SELECT a.attname AS column_name
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped AND a.attidentity IN ('a', 'd')`;

const TRIGGER_FACTS_SQL = `SELECT '${RELATION_FACT_KIND.TRIGGER}' AS kind, t.tgname::text AS name
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2 AND NOT t.tgisinternal`;

const RULE_FACTS_SQL = `SELECT '${RELATION_FACT_KIND.RULE}' AS kind, r.rulename::text AS name
FROM pg_catalog.pg_rewrite r
JOIN pg_catalog.pg_class c ON c.oid = r.ev_class
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2 AND r.rulename <> '${RETURN_RULE_NAME}'`;

const TRIGGER_AND_RULE_FACTS_SQL = `${TRIGGER_FACTS_SQL}
UNION ALL
${RULE_FACTS_SQL}`;

const PADRON_ID_SEQUENCE_SQL =
  "SELECT pg_catalog.pg_get_serial_sequence(format('%I.%I', $1::text, $2::text), $3::text) AS sequence_name";

export async function readRelationKind(session: CatalogQuerySession, layout: TableName): Promise<string | undefined> {
  const result = await session.query(RELATION_KIND_SQL, [layout.schema, layout.table]);
  const relkind = result.rows[0]?.relkind;
  return relkind === undefined || relkind === null ? undefined : String(relkind);
}

export async function readIdentityColumns(session: CatalogQuerySession, layout: TableName): Promise<string[]> {
  const result = await session.query(IDENTITY_COLUMNS_SQL, [layout.schema, layout.table]);
  return result.rows.map((row) => String(row.column_name));
}

export async function readPadronIdSequence(
  session: CatalogQuerySession,
  layout: TableName,
  idColumn: string
): Promise<string | null> {
  const result = await session.query(PADRON_ID_SEQUENCE_SQL, [layout.schema, layout.table, idColumn]);
  const sequence = result.rows[0]?.sequence_name;
  return sequence === undefined || sequence === null ? null : String(sequence);
}

export async function readTriggerAndRuleFacts(session: CatalogQuerySession, layout: TableName): Promise<RelationFact[]> {
  const result = await session.query(TRIGGER_AND_RULE_FACTS_SQL, [layout.schema, layout.table]);
  return result.rows.map((row) => ({
    kind: row.kind === RELATION_FACT_KIND.RULE ? RELATION_FACT_KIND.RULE : RELATION_FACT_KIND.TRIGGER,
    name: String(row.name),
  }));
}
