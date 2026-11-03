import { q } from "../../shared/sqlFragments";

const INSERTED_IDS_TABLE_NAME = "padron_inserted_ids";
const REASSIGN_IDS_TABLE_NAME = "padron_reassign_ids";
export const SESSION_IDS_COLUMN = "id";

/** AP-113: the ids this run's apply statement inserted: the only receivers a reassignment may use. Session-local, dropped at COMMIT or ROLLBACK. */
export const INSERTED_IDS_TABLE_SQL = `pg_temp.${q(INSERTED_IDS_TABLE_NAME)}`;

/** AP-112: the subdivided padrones whose references the real run moves to their parts before deleting them. */
export const REASSIGN_IDS_TABLE_SQL = `pg_temp.${q(REASSIGN_IDS_TABLE_NAME)}`;

const createIdsTableSql = (name: string): string =>
  `CREATE TEMP TABLE ${q(name)} (${q(SESSION_IDS_COLUMN)} integer PRIMARY KEY) ON COMMIT DROP;`;

export const buildCreateInsertedIdsTableSql = (): string => createIdsTableSql(INSERTED_IDS_TABLE_NAME);
export const buildCreateReassignIdsTableSql = (): string => createIdsTableSql(REASSIGN_IDS_TABLE_NAME);
