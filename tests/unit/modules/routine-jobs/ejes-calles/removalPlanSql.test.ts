import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EJES_SKIP_KIND, EJES_SKIP_REASON, INVALID_CHOICE_REFS_LIMIT, RENUMBER_SKIP_REASON } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { LOAD_TEMP } from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadSelectionSql";
import {
  buildHoldGroupCopiesSql,
  buildMergePlanSql,
  buildMissingMoveTargetsSql,
  buildPlainPlanSql,
  buildSkippedListSql,
  buildSkippedReasonCountsSql,
  buildSkippedTableSql,
} from "@/modules/routine-jobs/jobs/ejes-calles/domain/removalPlanSql";
import { MOVE_TARGET_MISSING_MESSAGE, moveTargetMissingOf } from "@/modules/routine-jobs/jobs/ejes-calles/services/writeStatements";
import { ejesLayouts } from "./ejesFixtures";
import { createEjesDatabase, insertSection, rowsOf, type Row } from "./ejesLoadHarness";

const HOOK_TIMEOUT_MS = 60_000;

describe("ejes removal plan SQL on PGlite (EJS-1, EJS-9, EJL-12)", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = await createEjesDatabase(PGlite);
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  }, HOOK_TIMEOUT_MS);

  /** Temp tables live until the end of the transaction, so each test runs inside one and rolls it back. */
  const inTransaction = async (setup: () => Promise<void>, query: string): Promise<Row[]> => {
    await database.exec("BEGIN");
    try {
      await setup();
      return (await rowsOf(database, query)) as Row[];
    } finally {
      await database.exec("ROLLBACK");
    }
  };

  const createCopies = async (refs: string[]): Promise<void> => {
    await database.exec(`CREATE TEMP TABLE "${LOAD_TEMP.COPY}" (copy_id bigint, ref text, idcalle text)`);
    for (const [index, ref] of refs.entries()) {
      await database.query(`INSERT INTO pg_temp."${LOAD_TEMP.COPY}" (copy_id, ref, idcalle) VALUES ($1, $2, '1')`, [index + 1, ref]);
    }
  };

  describe("buildHoldGroupCopiesSql (EJS-1, EJL-12)", () => {
    it("should delete the copies of split pieces and of new reftramos of merges that are not applied, and keep every other copy", async () => {
      const remaining = await inTransaction(
        async () => {
          await createCopies(["7001", "7002", "7003", "7004", "7005"]);
          await database.exec(`CREATE TEMP TABLE "${LOAD_TEMP.SPLIT}" (old_id bigint, old_ref text, idcalle text, points bigint, new_ref text)`);
          await database.exec(`INSERT INTO pg_temp."${LOAD_TEMP.SPLIT}" VALUES (1, '6900', '3', 0, '7001')`);
          await database.exec(`CREATE TEMP TABLE "${LOAD_TEMP.SPLIT_PLAN}" (old_id bigint, old_ref text, idcalle text, points bigint, reason text)`);
          await database.exec(`INSERT INTO pg_temp."${LOAD_TEMP.SPLIT_PLAN}" VALUES (1, '6900', '3', 0, '${EJES_SKIP_REASON.NOT_ACCEPTED}')`);
          await database.exec(`CREATE TEMP TABLE "${LOAD_TEMP.MERGE_PLAN}" (new_ref text, idcalle text, refs text, points bigint, reason text)`);
          await database.exec(
            `INSERT INTO pg_temp."${LOAD_TEMP.MERGE_PLAN}" VALUES ('7002', '3', '6800,6801', 0, '${EJES_SKIP_REASON.NOT_ACCEPTED}'), ('7003', '3', '6802', 0, NULL)`
          );
          await database.exec(buildHoldGroupCopiesSql());
        },
        `SELECT ref FROM pg_temp."${LOAD_TEMP.COPY}" ORDER BY ref`
      );

      expect(remaining.map((row) => row.ref)).toEqual(["7003", "7004", "7005"]);
    });

    it("should delete nothing when no split and no merge is held", async () => {
      const remaining = await inTransaction(
        async () => {
          await createCopies(["7101", "7102"]);
          await database.exec(`CREATE TEMP TABLE "${LOAD_TEMP.SPLIT}" (old_id bigint, old_ref text, idcalle text, points bigint, new_ref text)`);
          await database.exec(`CREATE TEMP TABLE "${LOAD_TEMP.SPLIT_PLAN}" (old_id bigint, old_ref text, idcalle text, points bigint, reason text)`);
          await database.exec(`CREATE TEMP TABLE "${LOAD_TEMP.MERGE_PLAN}" (new_ref text, idcalle text, refs text, points bigint, reason text)`);
          await database.exec(buildHoldGroupCopiesSql());
        },
        `SELECT ref FROM pg_temp."${LOAD_TEMP.COPY}" ORDER BY ref`
      );

      expect(remaining.map((row) => row.ref)).toEqual(["7101", "7102"]);
    });
  });

  describe("buildHoldGroupCopiesSql text (EJS-1, EJL-12)", () => {
    it("should keep the exact delete of the held split and merge copies, unchanged by the id-point rules", () => {
      expect(buildHoldGroupCopiesSql()).toBe(
        'DELETE FROM pg_temp."ej_copy" AS c WHERE c.ref IN (SELECT s.new_ref FROM pg_temp."ej_split" AS s JOIN pg_temp."ej_split_plan" AS sp ON sp.old_id = s.old_id WHERE sp.reason IS NOT NULL) OR c.ref IN (SELECT p.new_ref FROM pg_temp."ej_merge_plan" AS p WHERE p.reason IS NOT NULL)'
      );
    });
  });

  describe("buildMergePlanSql reasons and points (EJS-4, EJ-21, EJL-12)", () => {
    const sql = buildMergePlanSql();
    const sharedBranch = `WHEN g.shared THEN '${EJES_SKIP_REASON.SHARED_OLD_REF}'`;

    it("should give shared_old_ref after the repeated_old_ref check", () => {
      const repeated = sql.indexOf(`WHEN g.repeated THEN '${EJES_SKIP_REASON.REPEATED_OLD_REF}'`);
      const shared = sql.indexOf(sharedBranch);

      expect(repeated).toBeGreaterThan(-1);
      expect(shared).toBeGreaterThan(repeated);
    });

    it("should flag a shared old section only through an accepted merge with the same old section and another new reftramo, as a grouped join", () => {
      expect(sql).toContain("bool_or(so.old_id IS NOT NULL) AS shared");
      expect(sql).toContain(
        'SELECT o.old_id FROM pg_temp."ej_merge" AS o JOIN pg_temp."ej_acc_merge" AS oa ON oa.ref = o.new_ref GROUP BY o.old_id HAVING count(DISTINCT o.new_ref) > 1'
      );
      expect(sql).toContain('LEFT JOIN (SELECT o.old_id FROM pg_temp."ej_merge" AS o');
      expect(sql).not.toContain('pg_temp."ej_acc_plain"');
    });

    it("should count the kept copies of each merge reftramo in a grouped join, not in a correlated count", () => {
      expect(sql).toContain("SELECT c.ref, count(*) AS copies FROM pg_temp.\"ej_copy\" AS c WHERE c.ref IN (SELECT m.new_ref FROM pg_temp.\"ej_merge\" AS m) GROUP BY c.ref");
      expect(sql).toContain("LEFT JOIN (SELECT c.ref, count(*) AS copies");
      expect(sql).not.toMatch(/\(SELECT count\(/);
    });

    it("should give points_by_id to a merge with a member whose road_section.id has points, before the repeated check", () => {
      const idLinked = sql.indexOf(`WHEN g.id_linked THEN '${EJES_SKIP_REASON.ID_LINKED_POINTS}'`);
      const repeated = sql.indexOf(`WHEN g.repeated THEN '${EJES_SKIP_REASON.REPEATED_OLD_REF}'`);

      expect(EJES_SKIP_REASON.ID_LINKED_POINTS).toBe("points_by_id");
      expect(idLinked).toBeGreaterThan(-1);
      expect(repeated).toBeGreaterThan(idLinked);
      expect(sql).toContain("bool_or(m.id_points > 0) AS id_linked");
    });

    it("should count a merge's points as the reftramo points plus the id points of every member", () => {
      expect(sql).toContain("sum(m.points + m.id_points)::bigint AS points");
    });
  });

  describe("buildPlainPlanSql reasons (EJS-9, EJ-21)", () => {
    it("should hold a plain removal with has_points whenever its points, reftramo or id, are above zero", () => {
      const sql = buildPlainPlanSql();

      expect(sql).toContain(`WHEN p.points > 0 THEN '${EJES_SKIP_REASON.HAS_POINTS}'`);
      expect(sql).toContain('FROM pg_temp."ej_plain" AS p LEFT JOIN pg_temp."ej_acc_plain" AS a ON a.ref = p.ref');
    });
  });

  describe("buildSkippedTableSql and its list (EJL-12, EJS-1)", () => {
    const createPlans = async (): Promise<void> => {
      await database.exec(`CREATE TEMP TABLE "${LOAD_TEMP.SPLIT}" (old_id bigint, old_ref text, idcalle text, points bigint, new_ref text)`);
      await database.exec(
        `INSERT INTO pg_temp."${LOAD_TEMP.SPLIT}" VALUES (1, '6900', '3', 2, '7001'), (1, '6900', '3', 2, '7002')`
      );
      await database.exec(`CREATE TEMP TABLE "${LOAD_TEMP.SPLIT_PLAN}" (old_id bigint, old_ref text, idcalle text, points bigint, reason text)`);
      await database.exec(`INSERT INTO pg_temp."${LOAD_TEMP.SPLIT_PLAN}" VALUES (1, '6900', '3', 2, '${EJES_SKIP_REASON.REVIEW_REQUIRED}')`);
      await database.exec(`CREATE TEMP TABLE "${LOAD_TEMP.MERGE_PLAN}" (new_ref text, idcalle text, refs text, points bigint, reason text)`);
      await database.exec(
        `INSERT INTO pg_temp."${LOAD_TEMP.MERGE_PLAN}" VALUES ('7100', '4', '6800,6801', 3, '${EJES_SKIP_REASON.NOT_ACCEPTED}'), ('7200', '4', '6810', 0, NULL)`
      );
      await database.exec(`CREATE TEMP TABLE "${LOAD_TEMP.PLAIN_PLAN}" (old_id bigint, ref text, idcalle text, points bigint, reason text, kind text)`);
      await database.exec(
        `INSERT INTO pg_temp."${LOAD_TEMP.PLAIN_PLAN}" VALUES (5, '6700', '5', 0, '${EJES_SKIP_REASON.NOT_ACCEPTED}', '${EJES_SKIP_KIND.REMOVAL}'), (6, '6701', '5', 0, NULL, '${EJES_SKIP_KIND.REMOVAL}')`
      );
      await database.exec(`CREATE TEMP TABLE "${LOAD_TEMP.HELD}" (old_id bigint, old_ref text, new_ref text, idcalle text, points bigint, reason text)`);
      await database.exec(
        `INSERT INTO pg_temp."${LOAD_TEMP.HELD}" VALUES (9, '3001', '3002', '5', 2, '${RENUMBER_SKIP_REASON.NOT_SINGLE_COPY}'), (10, '3001', '3002', '5', 2, '${RENUMBER_SKIP_REASON.NOT_SINGLE_COPY}')`
      );
    };

    it("should list one row per split, merge, held removal and renumber pair, with applied rows left out", async () => {
      const rows = await inTransaction(async () => {
        await createPlans();
        await database.exec(buildSkippedTableSql());
      }, buildSkippedListSql(100));

      expect(rows.map((row) => [row.kind, row.refs, row.new_refs, row.reason])).toEqual(
        expect.arrayContaining([
          [EJES_SKIP_KIND.SPLIT, "6900", "7001,7002", EJES_SKIP_REASON.REVIEW_REQUIRED],
          [EJES_SKIP_KIND.MERGE, "6800,6801", "7100", EJES_SKIP_REASON.NOT_ACCEPTED],
          [EJES_SKIP_KIND.REMOVAL, "6700", "", EJES_SKIP_REASON.NOT_ACCEPTED],
        ])
      );
      expect(rows).toHaveLength(4);
      expect(rows.some((row) => row.refs === "6810" || row.refs === "6701")).toBe(false);
    });

    it("should list a renumber held pair once even when the held table holds it twice (one row per pair)", async () => {
      const rows = await inTransaction(async () => {
        await createPlans();
        await database.exec(buildSkippedTableSql());
      }, buildSkippedListSql(100));

      const renumber = rows.filter((row) => row.kind === EJES_SKIP_KIND.RENUMBER);
      expect(renumber).toHaveLength(1);
      expect([renumber[0].refs, renumber[0].new_refs, renumber[0].reason]).toEqual(["3001", "3002", RENUMBER_SKIP_REASON.NOT_SINGLE_COPY]);
    });

    it("should count every skipped row by reason, and cap the list only", async () => {
      const counts = await inTransaction(async () => {
        await createPlans();
        await database.exec(buildSkippedTableSql());
      }, buildSkippedReasonCountsSql());

      expect(counts.map((row) => [row.reason, Number(row.count)]).sort()).toEqual(
        [
          [EJES_SKIP_REASON.REVIEW_REQUIRED, 1],
          [EJES_SKIP_REASON.NOT_ACCEPTED, 2],
          [RENUMBER_SKIP_REASON.NOT_SINGLE_COPY, 1],
        ].sort()
      );
    });

    it("should return only the first limit rows of the list, the one with the most points first", async () => {
      const rows = await inTransaction(async () => {
        await createPlans();
        await database.exec(buildSkippedTableSql());
      }, buildSkippedListSql(1));

      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe(EJES_SKIP_KIND.MERGE);
      expect(Number(rows[0].points)).toBe(3);
    });
  });

  describe("buildMissingMoveTargetsSql and moveTargetMissingOf (EJL-29)", () => {
    const createMoveTables = async (): Promise<void> => {
      await database.exec(
        `CREATE TEMP TABLE "${LOAD_TEMP.SPLIT_FINAL}" (old_id bigint, old_ref text, point_id bigint, new_ref text, old_value text)`
      );
      await database.exec(`CREATE TEMP TABLE "${LOAD_TEMP.MOVE}" (old_ref text, new_ref text, points bigint)`);
    };

    it("should read the split points and the moves, keep the targets with no kept copy and no section, and limit them to INVALID_CHOICE_REFS_LIMIT", () => {
      const sql = buildMissingMoveTargetsSql(ejesLayouts());

      expect(sql).toContain(`FROM pg_temp."${LOAD_TEMP.SPLIT_FINAL}" AS f`);
      expect(sql).toContain(`FROM pg_temp."${LOAD_TEMP.MOVE}" AS n`);
      expect(sql).toContain(`WHERE NOT EXISTS (SELECT 1 FROM pg_temp."${LOAD_TEMP.COPY}" AS c WHERE c.ref = t.new_ref)`);
      expect(sql).toContain('AND NOT EXISTS (SELECT 1 FROM "cur" AS r WHERE r.ref = t.new_ref)');
      expect(sql.endsWith(`ORDER BY m.new_ref LIMIT ${INVALID_CHOICE_REFS_LIMIT}`)).toBe(true);
    });

    it("should return no target when every move target is a kept copy or an existing section", async () => {
      const rows = await inTransaction(
        async () => {
          await createMoveTables();
          await createCopies(["6501"]);
          await insertSection(database, { ref: 6502, calle: 1, geom: "0:10" });
          await database.exec(`INSERT INTO pg_temp."${LOAD_TEMP.SPLIT_FINAL}" VALUES (1, '6500', 1, '6501', '6500')`);
          await database.exec(`INSERT INTO pg_temp."${LOAD_TEMP.MOVE}" VALUES ('6500', '6502', 2)`);
        },
        buildMissingMoveTargetsSql(ejesLayouts())
      );

      expect(rows).toEqual([]);
    });

    it("should list only the target that no kept copy and no section holds, with its old reftramo", async () => {
      const rows = await inTransaction(
        async () => {
          await createMoveTables();
          await createCopies(["6511"]);
          await insertSection(database, { ref: 6512, calle: 1, geom: "0:10" });
          await database.exec(`INSERT INTO pg_temp."${LOAD_TEMP.SPLIT_FINAL}" VALUES (1, '6510', 1, '6511', '6510')`);
          await database.exec(`INSERT INTO pg_temp."${LOAD_TEMP.MOVE}" VALUES ('6510', '6512', 1), ('6514', '6513', 1)`);
        },
        buildMissingMoveTargetsSql(ejesLayouts())
      );

      expect(rows.map((row) => [row.new_ref, row.old_ref])).toEqual([["6513", "6514"]]);
    });

    it("should list a missing target once, with its first old reftramo, when several points move to it", async () => {
      const rows = await inTransaction(
        async () => {
          await createMoveTables();
          await createCopies([]);
          await database.exec(
            `INSERT INTO pg_temp."${LOAD_TEMP.SPLIT_FINAL}" VALUES (1, '6601', 1, '7001', '6601'), (2, '6600', 2, '7001', '6600')`
          );
          await database.exec(`INSERT INTO pg_temp."${LOAD_TEMP.MOVE}" VALUES ('6602', '7001', 3)`);
        },
        buildMissingMoveTargetsSql(ejesLayouts())
      );

      expect(rows.map((row) => [row.new_ref, row.old_ref])).toEqual([["7001", "6600"]]);
    });

    it("should cut the missing targets at INVALID_CHOICE_REFS_LIMIT, the lowest refs first (boundary)", async () => {
      const rows = await inTransaction(
        async () => {
          await createMoveTables();
          await createCopies([]);
          for (let index = 1; index <= INVALID_CHOICE_REFS_LIMIT + 2; index += 1) {
            await database.query(`INSERT INTO pg_temp."${LOAD_TEMP.MOVE}" VALUES ('6700', $1, 1)`, [`710${index}`]);
          }
        },
        buildMissingMoveTargetsSql(ejesLayouts())
      );

      expect(rows.map((row) => row.new_ref)).toEqual(["7101", "7102", "7103", "7104", "7105"]);
    });

    it("should name each missing target as destino (de origen) in the message, after the plain message", () => {
      expect(MOVE_TARGET_MISSING_MESSAGE).toBe(
        "Los puntos de acceso se moverían a un reftramo que no existirá después de la carga. Vuelva a analizar."
      );
      expect(moveTargetMissingOf(["8888 (de 7777)"])).toBe(`${MOVE_TARGET_MISSING_MESSAGE} Destinos: 8888 (de 7777).`);
      expect(moveTargetMissingOf(["8888 (de 7777)", "8889 (de 7778)"])).toBe(
        `${MOVE_TARGET_MISSING_MESSAGE} Destinos: 8888 (de 7777), 8889 (de 7778).`
      );
    });
  });
});
