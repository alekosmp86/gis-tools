import { vi } from "vitest";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { GENERIC_SRID } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { RunDeps, RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import {
  COMPLETAR_ADDRESS_MASTER_COLUMN,
  COMPLETAR_UNIT_COLUMN,
} from "@/modules/routine-jobs/jobs/completar-unidad-territorial/constants";
import type {
  CompletarLayouts,
  CompletarLinkedUnit,
  CompletarParams,
  CompletarResult,
} from "@/modules/routine-jobs/jobs/completar-unidad-territorial/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

type Row = Record<string, unknown>;

export const COMPLETAR_PASSWORD = "Completar-pw!3";
const UNIT_SCHEMA = "carto";
const UNIT_TABLE = "territorial_unit";
const ADDRESS_MASTER_SCHEMA = "carto";
const ADDRESS_MASTER_TABLE = "addresses_master";
export const UNIT_LABEL = "carto.territorial_unit";
export const ADDRESS_MASTER_LABEL = "carto.addresses_master";
const UNIT_SEQUENCE = "carto.territorial_unit_id_seq";
const ADDRESS_MASTER_SEQUENCE = "carto.addresses_master_addresses_master_id_seq";
export const COMMIT_SQL = "COMMIT";
export const ROLLBACK_SQL = "ROLLBACK";

const identityOf = (columns: readonly string[]): Record<string, string> =>
  Object.fromEntries(columns.map((column) => [column, column]));

export const completarLayoutsOf = (): CompletarLayouts => {
  const unit: TableLayout = {
    schema: UNIT_SCHEMA,
    table: UNIT_TABLE,
    columns: identityOf(Object.values(COMPLETAR_UNIT_COLUMN)),
  };
  const addressMaster: WritableTargetLayout = {
    schema: ADDRESS_MASTER_SCHEMA,
    table: ADDRESS_MASTER_TABLE,
    columns: identityOf(Object.values(COMPLETAR_ADDRESS_MASTER_COLUMN)),
    srid: GENERIC_SRID,
    idColumn: COMPLETAR_ADDRESS_MASTER_COLUMN.ID,
    idSequence: ADDRESS_MASTER_SEQUENCE,
    identityColumns: [],
    catalog: [],
  };
  return { unit, addressMaster };
};

export const completarParamsOf = (overrides: Partial<CompletarParams> = {}): CompletarParams => ({
  config: {
    host: "db.local",
    port: "5432",
    db_name: "gis",
    user: "gis_user",
    password: COMPLETAR_PASSWORD,
    schema_name: "",
    table_name: "",
  },
  unitSchema: UNIT_SCHEMA,
  unitTable: UNIT_TABLE,
  addressMasterSchema: ADDRESS_MASTER_SCHEMA,
  addressMasterTable: ADDRESS_MASTER_TABLE,
  dryRun: false,
  confirm: true,
  ...overrides,
});

export const linkedUnitOf = (overrides: Partial<CompletarLinkedUnit> = {}): CompletarLinkedUnit => ({
  id: 101,
  name: "Unidad uno",
  provinceId: "02",
  addressMasterId: 501,
  created: true,
  ...overrides,
});

export const completarResultOf = (overrides: Partial<CompletarResult> = {}): CompletarResult => ({
  dryRun: false,
  targetModified: true,
  outcomeUnknown: false,
  unitSchema: UNIT_SCHEMA,
  unitTable: UNIT_LABEL,
  addressMasterTable: ADDRESS_MASTER_LABEL,
  counts: { withoutAddressMaster: 2, created: 1, linked: 2, alreadyHadRecord: 1, ambiguous: 0 },
  linkedList: [linkedUnitOf(), linkedUnitOf({ id: 102, name: "Unidad dos", addressMasterId: 17, created: false })],
  ambiguousSamples: [],
  warnings: [],
  stepTimings: [{ label: "Validar tablas y columnas", ms: 1000 }],
  ...overrides,
});

export interface CompletarScenario {
  toCreate?: number;
  alreadyHadRecord?: number;
  ambiguous?: number;
  ambiguousSamples?: Row[];
  appliedCreated?: number;
  appliedLinked?: number;
  linkedList?: Row[];
  remaining?: number;
  unitColumns?: Row[];
  addressMasterColumns?: Row[];
  unitTriggers?: string[];
  deniedPrivileges?: string[];
  unownedAddressSequence?: boolean;
  failOn?: string;
  failMessage?: string;
  commitFails?: boolean;
  commitMessage?: string;
}

const column = (name: string, dataType: string, overrides: Partial<Row> = {}): Row => ({
  column_name: name,
  data_type: dataType,
  is_nullable: true,
  column_default: null,
  ...overrides,
});

const unitCatalog = (): Row[] => [
  column("id", "integer", { is_nullable: false, column_default: `nextval('${UNIT_SEQUENCE}'::regclass)` }),
  column("name", "text"),
  column("id_province", "integer"),
  column("id_address_master", "integer"),
];

const addressMasterCatalog = (unowned: boolean): Row[] => [
  column("addresses_master_id", "integer", {
    is_nullable: unowned,
    column_default: unowned ? null : `nextval('${ADDRESS_MASTER_SEQUENCE}'::regclass)`,
  }),
  column("urn", "text"),
  column("latitud", "double precision"),
  column("longitud", "double precision"),
];

const CLASSIFICATION_DEFAULTS = { without_address_master: 2, to_create: 1, already_had_record: 1, ambiguous: 0 };

const DEFAULT_LINKED_LIST: Row[] = [
  { id: 101, name: "Unidad uno", provinceId: "02", addressMasterId: 501, created: true },
  { id: 102, name: "Unidad dos", provinceId: "02", addressMasterId: 17, created: false },
];

const catalogOf = (scenario: CompletarScenario, table: string): Row[] => {
  if (table === UNIT_TABLE) return scenario.unitColumns ?? unitCatalog();
  if (table === ADDRESS_MASTER_TABLE) {
    return scenario.addressMasterColumns ?? addressMasterCatalog(scenario.unownedAddressSequence === true);
  }
  return [];
};

const classificationOf = (scenario: CompletarScenario): Row => {
  const toCreate = scenario.toCreate ?? CLASSIFICATION_DEFAULTS.to_create;
  const ambiguous = scenario.ambiguous ?? CLASSIFICATION_DEFAULTS.ambiguous;
  const alreadyHadRecord = scenario.alreadyHadRecord ?? CLASSIFICATION_DEFAULTS.already_had_record;
  return {
    without_address_master: toCreate + alreadyHadRecord + ambiguous,
    to_create: toCreate,
    already_had_record: alreadyHadRecord,
    ambiguous,
    ambiguous_samples: scenario.ambiguousSamples ?? [],
  };
};

const appliedOf = (scenario: CompletarScenario): Row => {
  const classification = classificationOf(scenario);
  return {
    created: scenario.appliedCreated ?? classification.to_create,
    linked: scenario.appliedLinked ?? Number(classification.without_address_master) - Number(classification.ambiguous),
    linked_list: scenario.linkedList ?? DEFAULT_LINKED_LIST,
  };
};

const remainingOf = (scenario: CompletarScenario): number => scenario.remaining ?? scenario.ambiguous ?? 0;

const sequenceOf = (scenario: CompletarScenario, table: string): string | null => {
  if (table === UNIT_TABLE) return UNIT_SEQUENCE;
  return scenario.unownedAddressSequence === true ? null : ADDRESS_MASTER_SEQUENCE;
};

const triggerRowsOf = (scenario: CompletarScenario, table: string): Row[] =>
  table === UNIT_TABLE ? (scenario.unitTriggers ?? []).map((name) => ({ kind: "trigger", name })) : [];

function answerOf(scenario: CompletarScenario, sql: string, values: unknown[] | undefined): Row[] {
  if (sql === COMMIT_SQL && scenario.commitFails) throw new Error(scenario.commitMessage ?? "commit rechazado");
  if (scenario.failOn !== undefined && sql.includes(scenario.failOn)) {
    throw new Error(scenario.failMessage ?? "fallo simulado");
  }
  if (sql.includes('AS "without_address_master"')) return [classificationOf(scenario)];
  if (sql.includes('AS "linked_list"')) return [appliedOf(scenario)];
  if (sql.includes('AS "remaining"')) return [{ remaining: remainingOf(scenario) }];
  if (sql.includes("setval")) return [];
  if (sql.includes("pg_attrdef")) return catalogOf(scenario, String(values?.[1]));
  if (sql.includes("relkind::text")) return [{ relkind: "r" }];
  if (sql.includes("pg_inherits")) return [{ has_children: false, is_child: false }];
  if (sql.includes("pg_trigger")) return triggerRowsOf(scenario, String(values?.[1]));
  if (sql.includes("attidentity")) return [];
  if (sql.includes("pg_get_serial_sequence")) return [{ sequence_name: sequenceOf(scenario, String(values?.[1])) }];
  if (sql.includes("to_regclass")) return [];
  if (sql.includes("has_table_privilege")) {
    const privilege = `${String(values?.[1])}.${String(values?.[2])}`;
    return [{ has_privilege: !(scenario.deniedPrivileges ?? []).includes(privilege) }];
  }
  if (sql.includes("has_sequence_privilege")) {
    return [{ has_privilege: !(scenario.deniedPrivileges ?? []).includes("sequence.UPDATE") }];
  }
  return [];
}

interface CompletarRunHarness {
  session: RunSession;
  deps: RunDeps;
  log: string[];
  openSession: ReturnType<typeof vi.fn>;
  closes: () => number;
}

export function completarRunOf(scenario: CompletarScenario = {}): CompletarRunHarness {
  const log: string[] = [];
  let closed = 0;
  const session: RunSession = {
    async query(sql: string, values?: unknown[]) {
      log.push(sql);
      await Promise.resolve();
      return { rows: answerOf(scenario, sql, values) };
    },
    async close() {
      closed += 1;
    },
  };
  const openSession = vi.fn(async () => session);
  return {
    session,
    deps: { openSession, now: () => 0 },
    log,
    openSession,
    closes: () => closed,
  };
}

export const indexOfSql = (log: readonly string[], predicate: (sql: string) => boolean): number =>
  log.findIndex(predicate);
