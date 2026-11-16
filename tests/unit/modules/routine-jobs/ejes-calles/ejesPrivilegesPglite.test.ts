import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertEjesLoadReady, ejesAnalyzeWarnings } from "@/modules/routine-jobs/jobs/ejes-calles/services/preflight";
import type { EjesLoadContext } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { createEjesDatabase, loadContextOn, sessionOn } from "./ejesLoadHarness";

const HOOK_TIMEOUT_MS = 60_000;

/** Everything the load writes or reads, except the UPDATE/DELETE/TRUNCATE the lock needs and the DELETE of removals and merges. */
const WRITE_GRANTS = [
  "GRANT USAGE ON SCHEMA carto, bdj_carto TO {role}",
  "GRANT SELECT ON bdj_carto.ide_ejesviacirculacion, bdj_carto.ine_localidades_pg, carto.mv_country_province, carto.padron TO {role}",
  "GRANT SELECT, INSERT, UPDATE ON carto.road_section TO {role}",
  "GRANT SELECT, INSERT ON carto.circulation_way, carto.addresses_master TO {role}",
  "GRANT SELECT, UPDATE ON carto.access_point TO {role}",
  "GRANT SELECT, INSERT, UPDATE, DELETE ON carto.road_section_vertices_pgr TO {role}",
  "GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA carto TO {role}",
];

const LOCK_UPDATE_GRANTS = [
  "GRANT UPDATE ON carto.road_section, carto.circulation_way, carto.addresses_master, carto.access_point, carto.road_section_vertices_pgr TO {role}",
];

const DELETE_GRANTS = ["GRANT DELETE ON carto.road_section, carto.addresses_master TO {role}"];

describe("ejes load privileges on PGlite (EJL-24)", () => {
  let database: PGlite;
  let context: EjesLoadContext;

  beforeEach(async () => {
    database = await createEjesDatabase(PGlite);
    context = await loadContextOn(database);
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    await database.exec("RESET ROLE").catch(() => undefined);
    await database.close();
  }, HOOK_TIMEOUT_MS);

  /** Creates a non-owner role with the given grants and makes it the current user of the connection. */
  const roleWith = async (name: string, grants: string[]): Promise<void> => {
    await database.exec(`CREATE ROLE ${name} NOLOGIN`);
    for (const statement of [...grants]) await database.exec(statement.replaceAll("{role}", name));
    await database.exec(`SET ROLE ${name}`);
  };

  /** A loader that can do everything of the load, DELETE on the removal tables included. */
  const loaderWith = (name: string, grants: string[]): Promise<void> => roleWith(name, [...WRITE_GRANTS, ...DELETE_GRANTS, ...grants]);

  it("should pass with every write and lock privilege, and return one ANALYZE warning per locked table the loader does not own (EJL-24, EJ-14)", async () => {
    await loaderWith("loader_full", LOCK_UPDATE_GRANTS);

    const warnings = await assertEjesLoadReady(sessionOn(database), context);

    expect(warnings).toHaveLength(5);
    expect(warnings.some((warning) => warning.includes("carto.road_section_vertices_pgr"))).toBe(true);
    for (const warning of warnings) {
      expect(warning).toContain("ANALYZE de");
      expect(warning).toContain("se omitiría");
      expect(warning).toContain("Es solo una advertencia y la carga continúa.");
    }
    expect(warnings.some((warning) => warning.includes("carto.road_section"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("carto.access_point"))).toBe(true);
  });

  it("should give the same non-owner ANALYZE warnings from ejesAnalyzeWarnings as the write check returns", async () => {
    await loaderWith("loader_warn", LOCK_UPDATE_GRANTS);

    const warnings = await ejesAnalyzeWarnings(sessionOn(database), context);

    expect(warnings).toHaveLength(5);
    expect(warnings[0]).toMatch(/^ANALYZE de .+ se omitiría: el usuario no es propietario de la tabla/);
  });

  it("should refuse before the lock when a locked table has none of UPDATE, DELETE or TRUNCATE, naming the table and the purpose (EJL-24)", async () => {
    await loaderWith("loader_nolock", ["GRANT UPDATE ON carto.road_section, carto.addresses_master, carto.access_point TO {role}"]);

    await expect(assertEjesLoadReady(sessionOn(database), context)).rejects.toThrow(
      /ninguno de los privilegios UPDATE, DELETE, TRUNCATE sobre la tabla carto\.circulation_way, necesarios para bloquear la tabla en la carga/
    );
  });

  it("should accept DELETE alone as the lock privilege of a locked table (any one of the three, EJL-24)", async () => {
    await loaderWith("loader_delete", [
      "GRANT UPDATE ON carto.road_section, carto.addresses_master, carto.access_point TO {role}",
      "GRANT DELETE ON carto.circulation_way TO {role}",
    ]);

    await expect(assertEjesLoadReady(sessionOn(database), context)).resolves.toHaveLength(5);
  });

  it("should accept TRUNCATE alone as the lock privilege of a locked table (any one of the three, EJL-24)", async () => {
    await loaderWith("loader_truncate", [
      "GRANT UPDATE ON carto.road_section, carto.circulation_way, carto.access_point TO {role}",
      "GRANT TRUNCATE ON carto.addresses_master TO {role}",
    ]);

    await expect(assertEjesLoadReady(sessionOn(database), context)).resolves.toHaveLength(5);
  });

  it("should refuse a missing DELETE on the road section table as a blocker, since merges and removals delete sections (EJS-9, EJL-24)", async () => {
    await roleWith("loader_nodelete_road", [...WRITE_GRANTS, ...LOCK_UPDATE_GRANTS, "GRANT DELETE ON carto.addresses_master TO {role}"]);

    await expect(assertEjesLoadReady(sessionOn(database), context)).rejects.toThrow(/No tiene privilegio DELETE sobre la tabla carto\.road_section/);
  });

  it("should refuse a missing DELETE on the address master table as a blocker, since merges and removals delete their masters (EJS-9, EJL-24)", async () => {
    await roleWith("loader_nodelete_master", [...WRITE_GRANTS, ...LOCK_UPDATE_GRANTS, "GRANT DELETE ON carto.road_section TO {role}"]);

    await expect(assertEjesLoadReady(sessionOn(database), context)).rejects.toThrow(/No tiene privilegio DELETE sobre la tabla carto\.addresses_master/);
  });

  it("should refuse a missing DELETE on the vertices table as a blocker, since the cleanup deletes unused vertices (EJ-27, EJL-24)", async () => {
    const grants = WRITE_GRANTS.filter((grant) => !grant.includes("road_section_vertices_pgr"));
    await roleWith("loader_nodelete_vertices", [...grants, "GRANT SELECT, INSERT, UPDATE ON carto.road_section_vertices_pgr TO {role}", ...DELETE_GRANTS]);

    await expect(assertEjesLoadReady(sessionOn(database), context)).rejects.toThrow(/No tiene privilegio DELETE sobre la tabla carto\.road_section_vertices_pgr/);
  });

  it("should refuse a missing INSERT on the vertices table as a blocker, since the topology step creates vertices (EJ-20, EJL-24)", async () => {
    const grants = WRITE_GRANTS.filter((grant) => !grant.includes("road_section_vertices_pgr"));
    await roleWith("loader_noinsert_vertices", [...grants, "GRANT SELECT, UPDATE, DELETE ON carto.road_section_vertices_pgr TO {role}", ...DELETE_GRANTS]);

    await expect(assertEjesLoadReady(sessionOn(database), context)).rejects.toThrow(/No tiene privilegio INSERT sobre la tabla carto\.road_section_vertices_pgr/);
  });

  it("should pass the write check when DELETE is granted on both removal tables, with no other grant beyond the load's", async () => {
    await loaderWith("loader_delete_both", LOCK_UPDATE_GRANTS);

    await expect(assertEjesLoadReady(sessionOn(database), context)).resolves.toHaveLength(5);
  });

  it("should refuse a missing INSERT on the road section table as a blocker, not as a warning (EJL-24)", async () => {
    await database.exec("CREATE ROLE loader_noinsert NOLOGIN");
    for (const statement of WRITE_GRANTS.filter((grant) => !grant.includes("carto.road_section TO"))) {
      await database.exec(statement.replaceAll("{role}", "loader_noinsert"));
    }
    await database.exec("GRANT SELECT, UPDATE, DELETE ON carto.road_section TO loader_noinsert");
    await database.exec("GRANT DELETE ON carto.addresses_master TO loader_noinsert");
    await database.exec(`GRANT UPDATE ON carto.circulation_way, carto.addresses_master, carto.access_point, carto.road_section_vertices_pgr TO loader_noinsert`);
    await database.exec("SET ROLE loader_noinsert");

    await expect(assertEjesLoadReady(sessionOn(database), context)).rejects.toThrow(/No tiene privilegio INSERT sobre la tabla carto\.road_section/);
  });

  it("should refuse a missing UPDATE on access_point, which the renumber needs to move the points (EJL-10, EJL-24)", async () => {
    await database.exec("CREATE ROLE loader_noupdate NOLOGIN");
    for (const statement of WRITE_GRANTS.filter((grant) => !grant.includes("access_point"))) {
      await database.exec(statement.replaceAll("{role}", "loader_noupdate"));
    }
    await database.exec("GRANT SELECT ON carto.access_point TO loader_noupdate");
    await database.exec("GRANT UPDATE ON carto.road_section, carto.circulation_way, carto.addresses_master TO loader_noupdate");
    await database.exec("GRANT DELETE ON carto.road_section, carto.addresses_master TO loader_noupdate");
    await database.exec("SET ROLE loader_noupdate");

    await expect(assertEjesLoadReady(sessionOn(database), context)).rejects.toThrow(/No tiene privilegio UPDATE sobre la tabla carto\.access_point/);
  });
});
