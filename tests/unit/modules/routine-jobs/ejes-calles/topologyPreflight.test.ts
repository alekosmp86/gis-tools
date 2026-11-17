import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { EJES_TABLE_ROLE, VERTICES_COLUMN } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import {
  LEADING_INDEX_SQL,
  PGR_SUPPORT_SQL,
  PGR_VERSION_SQL,
  topologyNameIssuesOf,
} from "@/modules/routine-jobs/jobs/ejes-calles/domain/topologySql";
import { assertEjesLoadReady, topologyIssuesOf } from "@/modules/routine-jobs/jobs/ejes-calles/services/preflight";
import { ejesLayouts, ejesLoadContextFixture } from "./ejesFixtures";
import { createEjesDatabase, loadContextOn, sessionOn } from "./ejesLoadHarness";

const HOOK_TIMEOUT_MS = 60_000;
const VERTICES = EJES_TABLE_ROLE.VERTICES;

const PGR_SIGNATURE = "pgr_createTopology(text, float8, text, text, text, text, text, boolean)";

const PGR_EXECUTE_MESSAGE = "No tiene privilegio EXECUTE sobre pgr_createTopology: la carga necesita ejecutarla.";

type IndexRow = { qualified: string; column_name: string; method: string };

/** One valid index per requirement of EJ-20: the btree on id, source and target, the GiST on the section and the vertex geometries. */
const INDEX_ROWS: IndexRow[] = [
  { qualified: "carto.road_section", column_name: "id", method: "btree" },
  { qualified: "carto.road_section", column_name: "source", method: "btree" },
  { qualified: "carto.road_section", column_name: "target", method: "btree" },
  { qualified: "carto.road_section", column_name: "geometry", method: "gist" },
  { qualified: "carto.road_section_vertices_pgr", column_name: "the_geom", method: "gist" },
];

const REQUIRED_INDEX_LABELS = [
  { label: "índice btree sobre carto.road_section(id)", row: INDEX_ROWS[0] },
  { label: "índice btree sobre carto.road_section(source)", row: INDEX_ROWS[1] },
  { label: "índice btree sobre carto.road_section(target)", row: INDEX_ROWS[2] },
  { label: "índice GiST sobre carto.road_section(geometry)", row: INDEX_ROWS[3] },
  { label: "índice GiST sobre carto.road_section_vertices_pgr(the_geom)", row: INDEX_ROWS[4] },
];

interface Support {
  installed: boolean;
  has_topology: boolean;
  can_execute: boolean;
}

/** A catalog session that answers the pgRouting probes and the index catalog; any other statement is a test error. */
const probesOf = (
  support: Partial<Support> & Pick<Support, "installed" | "has_topology">,
  version?: string,
  indexes: IndexRow[] = INDEX_ROWS
) => {
  const row = { can_execute: true, ...support };
  const query = vi.fn(async (sql: string) => {
    if (sql === PGR_SUPPORT_SQL) return { rows: [row] };
    if (sql === PGR_VERSION_SQL) return { rows: version === undefined ? [] : [{ version }] };
    if (sql === LEADING_INDEX_SQL) return { rows: indexes };
    throw new Error(`unexpected statement: ${sql}`);
  });
  return { session: { query } as unknown as CatalogQuerySession, query };
};

describe("topologyIssuesOf with a fake catalog session (EJ-20 preflight)", () => {
  it("should return no issue when pgRouting is installed, pgr_createTopology has the signature and the names are plain", async () => {
    const { session, query } = probesOf({ installed: true, has_topology: true }, "3.3.0");

    await expect(topologyIssuesOf(session, ejesLoadContextFixture())).resolves.toEqual([]);
    expect(query).toHaveBeenCalledWith(PGR_SUPPORT_SQL);
  });

  it("should block with the pgRouting message when pgRouting is not installed, and never read a version", async () => {
    const { session, query } = probesOf({ installed: false, has_topology: false });

    const issues = await topologyIssuesOf(session, ejesLoadContextFixture());

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/pgRouting no .+instalado/);
    expect(query).not.toHaveBeenCalledWith(PGR_VERSION_SQL);
  });

  it("should block with the version text when pgRouting is installed but has no pgr_createTopology with the signature", async () => {
    const { session } = probesOf({ installed: true, has_topology: false }, "3.2.0");

    const issues = await topologyIssuesOf(session, ejesLoadContextFixture());

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/pgRouting 3\.2\.0 no tiene pgr_createTopology/);
  });

  it("should name the version desconocida when pgr_version returns no row", async () => {
    const { session } = probesOf({ installed: true, has_topology: false });

    const issues = await topologyIssuesOf(session, ejesLoadContextFixture());

    expect(issues[0]).toMatch(/pgRouting desconocida no tiene pgr_createTopology/);
  });

  it("should list the name issues before the pgRouting issue, both as blockers", async () => {
    const { session } = probesOf({ installed: false, has_topology: false });

    const issues = await topologyIssuesOf(session, ejesLoadContextFixture([VERTICES, { table: "otra" }]));

    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatch(/debe ser carto\.road_section_vertices_pgr/);
    expect(issues[1]).toMatch(/pgRouting no .+instalado/);
  });

  it("should report the name issues of topologyNameIssuesOf unchanged, the text a dry run shows as information", async () => {
    const context = ejesLoadContextFixture([VERTICES, { table: "otra" }]);
    const indexes = [...INDEX_ROWS.slice(0, 4), { qualified: "carto.otra", column_name: "the_geom", method: "gist" }];
    const { session } = probesOf({ installed: true, has_topology: true }, "3.3.0", indexes);

    expect(await topologyIssuesOf(session, context)).toEqual(topologyNameIssuesOf(context));
  });

  it("should block with the EXECUTE message when pgRouting is installed with the signature but the user cannot execute it", async () => {
    const { session } = probesOf({ installed: true, has_topology: true, can_execute: false }, "3.3.0");

    const issues = await topologyIssuesOf(session, ejesLoadContextFixture());

    expect(issues).toEqual([PGR_EXECUTE_MESSAGE]);
  });

  it("should not report the EXECUTE message when the user can execute pgr_createTopology", async () => {
    const { session } = probesOf({ installed: true, has_topology: true, can_execute: true }, "3.3.0");

    const issues = await topologyIssuesOf(session, ejesLoadContextFixture());

    expect(issues).not.toContain(PGR_EXECUTE_MESSAGE);
  });

  it("should list the EXECUTE message after the name issues and before the index issue", async () => {
    const { session } = probesOf({ installed: true, has_topology: true, can_execute: false }, "3.3.0", []);

    const issues = await topologyIssuesOf(session, ejesLoadContextFixture([VERTICES, { table: "otra" }]));

    expect(issues).toHaveLength(3);
    expect(issues[0]).toMatch(/debe ser carto\.road_section_vertices_pgr/);
    expect(issues[1]).toBe(PGR_EXECUTE_MESSAGE);
    expect(issues[2]).toMatch(/Faltan índices/);
  });

  it("should return no issue when all five required indexes are present", async () => {
    const { session, query } = probesOf({ installed: true, has_topology: true }, "3.3.0", INDEX_ROWS);

    await expect(topologyIssuesOf(session, ejesLoadContextFixture())).resolves.toEqual([]);
    expect(query).toHaveBeenCalledWith(LEADING_INDEX_SQL, [["carto.road_section", "carto.road_section_vertices_pgr"]]);
  });

  it.each(REQUIRED_INDEX_LABELS)("should list the missing $label by name, in one blocker, and no other index", async ({ label, row }) => {
    const indexes = INDEX_ROWS.filter((entry) => entry !== row);
    const { session } = probesOf({ installed: true, has_topology: true }, "3.3.0", indexes);

    const issues = await topologyIssuesOf(session, ejesLoadContextFixture());

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("Faltan índices que pgr_createTopology necesita");
    expect(issues[0]).toContain(label);
    for (const other of REQUIRED_INDEX_LABELS.filter((entry) => entry.label !== label)) {
      expect(issues[0]).not.toContain(other.label);
    }
  });

  it("should list every missing index in the same blocker when several are missing", async () => {
    const indexes = INDEX_ROWS.filter((entry) => entry.column_name !== "source" && entry.column_name !== "geometry");
    const { session } = probesOf({ installed: true, has_topology: true }, "3.3.0", indexes);

    const issues = await topologyIssuesOf(session, ejesLoadContextFixture());

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("índice btree sobre carto.road_section(source)");
    expect(issues[0]).toContain("índice GiST sobre carto.road_section(geometry)");
  });

  it("should list an index whose column is present but with the wrong method, since pgRouting needs the named method", async () => {
    const indexes = INDEX_ROWS.map((entry) => (entry.column_name === "geometry" ? { ...entry, method: "btree" } : entry));
    const { session } = probesOf({ installed: true, has_topology: true }, "3.3.0", indexes);

    const issues = await topologyIssuesOf(session, ejesLoadContextFixture());

    expect(issues[0]).toContain("índice GiST sobre carto.road_section(geometry)");
  });

  it("should list the index issue as a blocker naming the index, the text the dry run shows as information", async () => {
    const indexes = INDEX_ROWS.filter((entry) => entry.column_name !== "target");
    const { session } = probesOf({ installed: true, has_topology: true }, "3.3.0", indexes);
    const context = ejesLoadContextFixture();

    const issues = await topologyIssuesOf(session, context);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/índice btree sobre carto\.road_section\(target\)/);
  });

  it("should block a vertices table whose id column is not id, since pgRouting names that column", () => {
    const columns = { ...ejesLayouts()[VERTICES].columns, [VERTICES_COLUMN.ID]: "vid" };

    const issues = topologyNameIssuesOf(ejesLoadContextFixture([VERTICES, { columns }]));

    expect(issues).toEqual([
      'La columna de id de la tabla de vértices debe llamarse "id": pgr_createTopology la usa por ese nombre.',
    ]);
  });

  it("should block a vertices table whose geometry column is not the_geom, since pgRouting names that column", () => {
    const columns = { ...ejesLayouts()[VERTICES].columns, [VERTICES_COLUMN.THE_GEOM]: "geom_vertice" };

    const issues = topologyNameIssuesOf(ejesLoadContextFixture([VERTICES, { columns }]));

    expect(issues).toEqual([
      'La columna de geometría de la tabla de vértices debe llamarse "the_geom": pgr_createTopology la usa por ese nombre.',
    ]);
  });

  it("should block both vertices column names, id first, when neither is id or the_geom", async () => {
    const columns = { ...ejesLayouts()[VERTICES].columns, [VERTICES_COLUMN.ID]: "vid", [VERTICES_COLUMN.THE_GEOM]: "geom_vertice" };
    const { session } = probesOf({ installed: true, has_topology: true }, "3.3.0");

    const issues = await topologyIssuesOf(session, ejesLoadContextFixture([VERTICES, { columns }]));

    expect(issues).toHaveLength(3);
    expect(issues[0]).toContain('"id"');
    expect(issues[1]).toContain('"the_geom"');
    expect(issues[2]).toContain("índice GiST sobre carto.road_section_vertices_pgr(geom_vertice)");
  });
});

describe("real-run preflight with pgRouting on PGlite (EJ-20)", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = await createEjesDatabase(PGlite);
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  }, HOOK_TIMEOUT_MS);

  it("should pass the real-run preflight when pgRouting and pgr_createTopology with the signature are present", async () => {
    await expect(assertEjesLoadReady(sessionOn(database), await loadContextOn(database), [], false)).resolves.toEqual([]);
  });

  it("should block the real run with the pgRouting message when pgRouting is not installed", async () => {
    await database.exec("DROP FUNCTION pgr_version()");

    await expect(assertEjesLoadReady(sessionOn(database), await loadContextOn(database), [], false)).rejects.toThrow(/pgRouting no .+instalado/);
  });

  it("should block the real run with the version text when the signature is missing", async () => {
    await database.exec(`DROP FUNCTION ${PGR_SIGNATURE}`);

    await expect(assertEjesLoadReady(sessionOn(database), await loadContextOn(database), [], false)).rejects.toThrow(
      /pgRouting 3\.3\.0-stub no tiene pgr_createTopology/
    );
  });

  it("should block the real run naming the btree index on source when that index is dropped", async () => {
    await database.exec("DROP INDEX carto.road_section_source_idx");

    await expect(assertEjesLoadReady(sessionOn(database), await loadContextOn(database), [], false)).rejects.toThrow(
      /Faltan índices que pgr_createTopology necesita: índice btree sobre carto\.road_section\(source\)\./
    );
  });

  it("should block the real run naming the GiST index on the vertices geometry when that index is dropped", async () => {
    await database.exec("DROP INDEX carto.road_section_vertices_geom_idx");

    await expect(assertEjesLoadReady(sessionOn(database), await loadContextOn(database), [], false)).rejects.toThrow(
      /índice GiST sobre carto\.road_section_vertices_pgr\(the_geom\)/
    );
  });

  it("should block the real run with exactly the index text the topology check returns, the text a dry run shows as information", async () => {
    await database.exec("DROP INDEX carto.road_section_target_idx");
    const context = await loadContextOn(database);
    const shown = await topologyIssuesOf(sessionOn(database), context);

    expect(shown).toHaveLength(1);
    expect(shown[0]).toBe(
      "Faltan índices que pgr_createTopology necesita: índice btree sobre carto.road_section(target). Si faltan, pgRouting los crea en la tabla y la carga no los revierte: créelos antes de cargar."
    );
    await expect(assertEjesLoadReady(sessionOn(database), context, [], false)).rejects.toThrow(shown[0]);
  });
});
