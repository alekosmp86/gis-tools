import { describe, it, expect, vi } from "vitest";
import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { readIdSequence } from "@/modules/routine-jobs/jobs/shared/tableFacts";
import { resolveWritableTarget, type TableSpec } from "@/modules/routine-jobs/jobs/shared/tableResolution";
import { resolveUnitLayouts } from "@/modules/routine-jobs/jobs/unidad-territorial/services/resolveLayouts";
import {
  UNIT_REQUIRED_COLUMNS_BY_ROLE,
  UNIT_TABLE_ROLE,
} from "@/modules/routine-jobs/jobs/unidad-territorial/constants";
import type { UnitParams } from "@/modules/routine-jobs/jobs/unidad-territorial/types";

/*
 * Fake session contract: pg_get_serial_sequence answers the owned sequence (or null); to_regclass answers the
 * canonical name of the bound regclass text (a null value answers a row with a null name, a missing key answers no row).
 * Catalog reads (pg_attrdef) answer the columns of the scenario's tables by table name, bound as values[1].
 */
type Row = Record<string, unknown>;

const SCHEMA = "carto";
const TABLE = "cadastral_locality";
const ID_COLUMN = "id";
const LAYOUT: TableLayout = { schema: SCHEMA, table: TABLE, columns: { id: ID_COLUMN } };
const DEFAULT_SEQUENCE_CANONICAL = "carto.cadastral_locality_id_seq";
const DEFAULT_SEQUENCE_BOUND = '"carto"."cadastral_locality_id_seq"';
const OWNED_SEQUENCE = "carto.owned_locality_id_seq";
const NEXTVAL_DEFAULT = "nextval('carto.cadastral_locality_id_seq'::regclass)";

interface SequenceAnswers {
  owned?: string | null;
  regclass?: Record<string, string | null>;
}

function regclassRowsOf(regclass: Record<string, string | null> | undefined, values: unknown[] | undefined): Row[] {
  const key = String(values?.[0]);
  if (regclass === undefined || !(key in regclass)) return [];
  return [{ sequence_name: regclass[key] }];
}

function sessionAnswering(answers: SequenceAnswers = {}) {
  const query = vi.fn(async (sql: string, values?: unknown[]): Promise<{ rows: Row[] }> => {
    if (sql.includes("pg_get_serial_sequence")) return { rows: [{ sequence_name: answers.owned ?? null }] };
    if (sql.includes("to_regclass")) return { rows: regclassRowsOf(answers.regclass, values) };
    return { rows: [] };
  });
  return { session: { query } as unknown as CatalogQuerySession, query };
}

const regclassCallsOf = (query: ReturnType<typeof sessionAnswering>["query"]): unknown[][] =>
  query.mock.calls.filter(([sql]) => sql.includes("to_regclass")).map(([, values]) => values ?? []);

describe("readIdSequence", () => {
  describe("owned sequence", () => {
    it("should return the owned sequence when pg_get_serial_sequence resolves one", async () => {
      const { session } = sessionAnswering({ owned: OWNED_SEQUENCE });

      const sequence = await readIdSequence(session, LAYOUT, ID_COLUMN, NEXTVAL_DEFAULT);

      expect(sequence).toBe(OWNED_SEQUENCE);
    });

    it("should not call to_regclass when the owned sequence is found, even with a nextval default", async () => {
      const { session, query } = sessionAnswering({ owned: OWNED_SEQUENCE });

      await readIdSequence(session, LAYOUT, ID_COLUMN, NEXTVAL_DEFAULT);

      expect(regclassCallsOf(query)).toEqual([]);
    });

    it("should bind schema, table and column as parameters of pg_get_serial_sequence", async () => {
      const { session, query } = sessionAnswering({ owned: OWNED_SEQUENCE });

      await readIdSequence(session, LAYOUT, ID_COLUMN, null);

      expect(query).toHaveBeenCalledWith(expect.stringContaining("pg_get_serial_sequence"), [SCHEMA, TABLE, ID_COLUMN]);
    });
  });

  describe("unowned sequence resolved from the column default", () => {
    it("should resolve the default nextval sequence to its canonical name via to_regclass", async () => {
      const { session } = sessionAnswering({ regclass: { [DEFAULT_SEQUENCE_BOUND]: DEFAULT_SEQUENCE_CANONICAL } });

      const sequence = await readIdSequence(session, LAYOUT, ID_COLUMN, NEXTVAL_DEFAULT);

      expect(sequence).toBe(DEFAULT_SEQUENCE_CANONICAL);
    });

    it("should pass the quoted sequence name as a bound parameter and never interpolate it into the SQL", async () => {
      const { session, query } = sessionAnswering({ regclass: { [DEFAULT_SEQUENCE_BOUND]: DEFAULT_SEQUENCE_CANONICAL } });

      await readIdSequence(session, LAYOUT, ID_COLUMN, NEXTVAL_DEFAULT);

      const regclassCall = query.mock.calls.find(([sql]) => sql.includes("to_regclass"));
      expect(regclassCall?.[1]).toEqual([DEFAULT_SEQUENCE_BOUND]);
      expect(regclassCall?.[0]).toContain("$1");
      expect(regclassCall?.[0]).not.toContain("cadastral_locality_id_seq");
    });

    it("should parse a mixed-case quoted sequence name and bind it still quoted", async () => {
      const { session } = sessionAnswering({ regclass: { '"Mixed"': 'public."Mixed"' } });

      const sequence = await readIdSequence(session, LAYOUT, ID_COLUMN, `nextval('"Mixed"'::regclass)`);

      expect(sequence).toBe('public."Mixed"');
    });

    it("should bind a schema-qualified mixed-case sequence name with each part quoted", async () => {
      const { session, query } = sessionAnswering({ regclass: { '"Esquema"."Mi Seq"': '"Esquema"."Mi Seq"' } });

      const sequence = await readIdSequence(session, LAYOUT, ID_COLUMN, `nextval('"Esquema"."Mi Seq"'::regclass)`);

      expect(sequence).toBe('"Esquema"."Mi Seq"');
      expect(regclassCallsOf(query)).toEqual([['"Esquema"."Mi Seq"']]);
    });

    it("should unescape doubled double quotes inside a quoted sequence name", async () => {
      const { session, query } = sessionAnswering({ regclass: {} });

      await readIdSequence(session, LAYOUT, ID_COLUMN, `nextval('"a""b"'::regclass)`);

      expect(regclassCallsOf(query)).toEqual([['"a""b"']]);
    });

    it("should bind an injection-shaped unqualified name as a parameter and never interpolate it", async () => {
      const { session, query } = sessionAnswering({ regclass: {} });

      const sequence = await readIdSequence(session, LAYOUT, ID_COLUMN, `nextval('carto.x; DROP TABLE y; --'::regclass)`);

      expect(sequence).toBeNull();
      const regclassCall = query.mock.calls.find(([sql]) => sql.includes("to_regclass"));
      expect(regclassCall?.[1]).toEqual(['"carto"."x; DROP TABLE y; --"']);
      expect(regclassCall?.[0]).not.toContain("DROP");
    });

    it("should resolve a sequence name carrying an apostrophe to its real name when the default escapes it", async () => {
      const apostropheSequence = "carto.o'brien_seq";
      const { session, query } = sessionAnswering({ regclass: { '"o\'brien_seq"': apostropheSequence } });

      const sequence = await readIdSequence(session, LAYOUT, ID_COLUMN, `nextval('"o''brien_seq"'::regclass)`);

      expect(regclassCallsOf(query)).toEqual([['"o\'brien_seq"']]);
      expect(sequence).toBe(apostropheSequence);
    });
  });

  describe("null and empty defaults", () => {
    it("should return null without querying to_regclass when the column default is null", async () => {
      const { session, query } = sessionAnswering({});

      const sequence = await readIdSequence(session, LAYOUT, ID_COLUMN, null);

      expect(sequence).toBeNull();
      expect(regclassCallsOf(query)).toEqual([]);
    });

    it("should return null without querying to_regclass when the column default is empty or whitespace only", async () => {
      const { session, query } = sessionAnswering({});

      const empty = await readIdSequence(session, LAYOUT, ID_COLUMN, "");
      const blank = await readIdSequence(session, LAYOUT, ID_COLUMN, "   ");

      expect(empty).toBeNull();
      expect(blank).toBeNull();
      expect(regclassCallsOf(query)).toEqual([]);
    });
  });

  describe("defaults that are not a plain nextval", () => {
    it.each([
      ["a text literal", "'abc'::text"],
      ["nextval with extra arguments", "nextval('carto.cadastral_locality_id_seq'::regclass, 5)"],
      ["a function call", "public.next_locality_id()"],
      ["a nextval with a trailing cast", "nextval('carto.cadastral_locality_id_seq'::regclass)::integer"],
      ["a nextval of a non-literal argument", "nextval(some_sequence_name)"],
    ])("should return null without querying to_regclass when the default is %s", async (_label, columnDefault) => {
      const { session, query } = sessionAnswering({ regclass: { [DEFAULT_SEQUENCE_BOUND]: DEFAULT_SEQUENCE_CANONICAL } });

      const sequence = await readIdSequence(session, LAYOUT, ID_COLUMN, columnDefault);

      expect(sequence).toBeNull();
      expect(regclassCallsOf(query)).toEqual([]);
    });
  });

  describe("to_regclass finds no sequence", () => {
    it("should return null when to_regclass answers no row for the default sequence", async () => {
      const { session } = sessionAnswering({ regclass: {} });

      const sequence = await readIdSequence(session, LAYOUT, ID_COLUMN, NEXTVAL_DEFAULT);

      expect(sequence).toBeNull();
    });

    it("should return null when the relation answers a row with a null sequence name", async () => {
      const { session } = sessionAnswering({ regclass: { [DEFAULT_SEQUENCE_BOUND]: null } });

      const sequence = await readIdSequence(session, LAYOUT, ID_COLUMN, NEXTVAL_DEFAULT);

      expect(sequence).toBeNull();
    });
  });
});

const TARGET_TABLE = "territorial_unit";
const TARGET_SCHEMA = "carto";
const TARGET_SEQUENCE_CANONICAL = "carto.territorial_unit_id_seq";
const TARGET_SEQUENCE_BOUND = '"carto"."territorial_unit_id_seq"';
const GEOMETRY_TYPE = "geometry(MultiPolygon,32721)";
const PROJ4_METRE = "+proj=utm +zone=21 +south +datum=WGS84 +units=m +no_defs";
const LOCALITY_TABLE = "localidades_catastrales_stg";
const TYPE_TABLE = "tipo_unidad";

const column = (name: string, dataType: string, columnDefault: string | null = null, isNullable = true): Row => ({
  column_name: name,
  data_type: dataType,
  is_nullable: isNullable,
  column_default: columnDefault,
});

function catalogsFor(targetDefault: string | null): Record<string, Row[]> {
  return {
    [LOCALITY_TABLE]: [
      column("name", "text"),
      column("id_font_type", "integer"),
      column("id_province", "integer"),
      column("geometry", GEOMETRY_TYPE),
    ],
    [TYPE_TABLE]: [column("id", "integer"), column("name", "text")],
    [TARGET_TABLE]: [
      column("id", "integer", targetDefault, false),
      column("name", "text"),
      column("id_territorial_unit_type", "integer"),
      column("id_font", "integer"),
      column("id_province", "integer"),
      column("geometry", GEOMETRY_TYPE),
    ],
  };
}

interface StageThreeAnswers {
  targetDefault: string | null;
  owned?: string | null;
}

function stageThreeSession({ targetDefault, owned = null }: StageThreeAnswers) {
  const catalogs = catalogsFor(targetDefault);
  const query = vi.fn(async (sql: string, values?: unknown[]): Promise<{ rows: Row[] }> => {
    if (sql.includes("pg_attrdef")) return { rows: catalogs[String(values?.[1])] ?? [] };
    if (sql.includes("srtext")) return { rows: [{ srtext: 'PROJCS["UTM 21S",UNIT["metre",1]]', proj4text: PROJ4_METRE }] };
    if (sql.includes("pg_get_serial_sequence")) return { rows: [{ sequence_name: owned }] };
    if (sql.includes("to_regclass")) {
      return { rows: values?.[0] === TARGET_SEQUENCE_BOUND ? [{ sequence_name: TARGET_SEQUENCE_CANONICAL }] : [] };
    }
    if (sql.includes('AS "matches"')) return { rows: [{ matches: 1, id: 42 }] };
    return { rows: [] };
  });
  return { session: { query } as unknown as CatalogQuerySession, query };
}

const targetSpec = (): TableSpec => ({
  label: `${TARGET_SCHEMA}.${TARGET_TABLE}`,
  schema: TARGET_SCHEMA,
  table: TARGET_TABLE,
  required: UNIT_REQUIRED_COLUMNS_BY_ROLE[UNIT_TABLE_ROLE.TARGET],
});

const unitParams = (): UnitParams => ({
  config: {
    host: "db.local",
    port: "5432",
    db_name: "gis",
    user: "gis_user",
    password: "Unidad-pw!7",
    schema_name: "",
    table_name: "",
  },
  localitySchema: "stg",
  localityTable: LOCALITY_TABLE,
  typeSchema: TARGET_SCHEMA,
  typeTable: TYPE_TABLE,
  targetSchema: TARGET_SCHEMA,
  targetTable: TARGET_TABLE,
  options: { localityTypeName: "LOCALIDAD CATASTRAL", tolerance: 1, updateGeometries: true },
  dryRun: false,
  confirm: true,
});

describe("readIdSequence through stage 3 (unidad-territorial) resolution", () => {
  describe("resolveWritableTarget", () => {
    it("should expose the canonical default sequence as idSequence when the target has no owned sequence", async () => {
      const { session } = stageThreeSession({ targetDefault: `nextval('${TARGET_SEQUENCE_CANONICAL}'::regclass)` });

      const resolved = await resolveWritableTarget(session, targetSpec());

      expect(resolved.target.idSequence).toBe(TARGET_SEQUENCE_CANONICAL);
    });

    it("should expose a null idSequence when the target has neither an owned sequence nor a nextval default", async () => {
      const { session } = stageThreeSession({ targetDefault: null });

      const resolved = await resolveWritableTarget(session, targetSpec());

      expect(resolved.target.idSequence).toBeNull();
    });

    it("should prefer the owned sequence over the column default", async () => {
      const { session, query } = stageThreeSession({
        targetDefault: `nextval('${TARGET_SEQUENCE_CANONICAL}'::regclass)`,
        owned: "carto.owned_unit_id_seq",
      });

      const resolved = await resolveWritableTarget(session, targetSpec());

      expect(resolved.target.idSequence).toBe("carto.owned_unit_id_seq");
      expect(query.mock.calls.some(([sql]) => sql.includes("to_regclass"))).toBe(false);
    });
  });

  describe("resolveUnitLayouts", () => {
    it("should carry the canonical default sequence into the unit target layout", async () => {
      const { session } = stageThreeSession({ targetDefault: `nextval('${TARGET_SEQUENCE_CANONICAL}'::regclass)` });

      const layouts = await resolveUnitLayouts(session, unitParams());

      expect(layouts.target.idSequence).toBe(TARGET_SEQUENCE_CANONICAL);
    });
  });
});
