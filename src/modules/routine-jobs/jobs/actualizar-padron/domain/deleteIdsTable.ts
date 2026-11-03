import { q } from "../../shared/sqlFragments";

const DELETE_IDS_TABLE_NAME = "padron_delete_ids";
export const DELETE_IDS_ID_COLUMN = "id";

/** AP-106: the real run's delete-eligible ids live here, never in a statement's text. Session-local and dropped at COMMIT or ROLLBACK. */
export const DELETE_IDS_TABLE_SQL = `pg_temp.${q(DELETE_IDS_TABLE_NAME)}`;

export const buildCreateDeleteIdsTableSql = (): string =>
  `CREATE TEMP TABLE ${q(DELETE_IDS_TABLE_NAME)} (${q(DELETE_IDS_ID_COLUMN)} integer PRIMARY KEY) ON COMMIT DROP;`;
