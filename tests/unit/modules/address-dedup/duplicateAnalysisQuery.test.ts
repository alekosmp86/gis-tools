import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  DUPLICATE_ANALYSIS_SQL,
  toQueryValues,
} from "@/modules/address-dedup/services/queries/duplicateAnalysisQuery";
import { mapAnalysisRow } from "@/modules/address-dedup/services/queries/mapAnalysisRow";
import { Decision, DecisionReason, DedupScope, Fuente } from "@/modules/address-dedup/constants";
import {
  analyze,
  createDedupDatabase,
  DEFAULT_LAT,
  DEFAULT_LNG,
  DEFAULT_PARAMETERS,
  findRow,
  insertAddress,
  markHasInternalUnits,
  markMatchedInNapDevice,
  markMatchedInServCto,
  resetDedupDatabase,
  urnOf,
  urnsOf,
} from "./pgliteHarness";

const ALL_GROUPS = { scope: DedupScope.ALL_DUPLICATE_GROUPS };

let database: PGlite;

beforeAll(async () => {
  database = await createDedupDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await resetDedupDatabase(database);
});

describe("duplicate analysis query", () => {
  describe("match key regressions", () => {
    it("should group ANTEL 4006567 and 4006568 (padron-only RURAL, number 0, same coordinates)", async () => {
      // Arrange
      const first = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 4006567 });
      const second = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 4006568 });

      // Act
      const rows = await analyze(database);

      // Assert
      expect(findRow(rows, first).group_id).toBe(findRow(rows, second).group_id);
      expect(findRow(rows, first).dup_group_size).toBe(2);
    });

    it("should keep TLK 4015195 (puerta 272) and 4015197 (puerta 266) in different groups", async () => {
      // Arrange
      await insertAddress(database, { fuente: Fuente.TLK, idNumber: 4015195, number: "272" });
      await insertAddress(database, { fuente: Fuente.TLK, idNumber: 4015197, number: "266" });

      // Act
      const rows = await analyze(database, ALL_GROUPS);

      // Assert: had they grouped, the pair would be a duplicate group and be listed.
      expect(rows).toEqual([]);
    });

    it("should keep ANTEL 4004103 (letter BIS, square 0) apart from IDE 684702 (letter N/A, square 100)", async () => {
      // Arrange
      const common = { streetName: "SANTISIMA TRINIDAD", number: "389", padron: null, typePadron: null };
      await insertAddress(database, { ...common, fuente: Fuente.ANTEL, idNumber: 4004103, letter: "BIS", square: "0" });
      await insertAddress(database, { ...common, fuente: Fuente.IDE, idNumber: 684702, letter: "N/A", square: "100" });

      // Act
      const rows = await analyze(database, ALL_GROUPS);

      // Assert
      expect(rows).toEqual([]);
    });

    it("should group ANTEL 4005609 with IDE 4756661 when letter and square are both placeholders", async () => {
      // Arrange
      const common = { streetName: "JOSE PEDRO VARELA", number: "154", padron: null, typePadron: null };
      const antel = await insertAddress(database, { ...common, fuente: Fuente.ANTEL, idNumber: 4005609, letter: "N/A", square: "0" });
      const ide = await insertAddress(database, { ...common, fuente: Fuente.IDE, idNumber: 4756661, letter: "N/A", square: "0", lat: DEFAULT_LAT + 0.00006 });

      // Act
      const rows = await analyze(database, ALL_GROUPS);

      // Assert
      expect(findRow(rows, antel).group_id).toBe(findRow(rows, ide).group_id);
    });

    it("should not group 96 rows sharing street and puerta 0 when each has its own padron and coordinates", async () => {
      // Arrange
      for (let index = 0; index < 96; index += 1) {
        await insertAddress(database, {
          fuente: Fuente.ANTEL,
          idNumber: 5000000 + index,
          streetName: "BALTASAR BRUM",
          number: "0",
          padron: String(100 + index),
          lat: DEFAULT_LAT + index * 0.01,
          lng: DEFAULT_LNG + index * 0.01,
        });
      }

      // Act
      const rows = await analyze(database, ALL_GROUPS);

      // Assert
      expect(rows).toEqual([]);
    });

    it("should separate rows with the same padron when the missing padron locality hides coordinates 50 km apart", async () => {
      // Arrange
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1, lat: -33.46, lng: -56.73 });
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2, lat: -33.01, lng: -56.73 });

      // Act
      const rows = await analyze(database, ALL_GROUPS);

      // Assert
      expect(rows).toEqual([]);
    });

    it("should group rows with the same padron when coordinates are 13 m apart in the same 2-decimal bucket", async () => {
      // Arrange
      const first = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1, lat: -33.4618, lng: -56.7307 });
      const second = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2, lat: -33.46192, lng: -56.7307 });

      // Act
      const rows = await analyze(database);

      // Assert
      expect(findRow(rows, first).group_id).toBe(findRow(rows, second).group_id);
    });

    it("should let a present padron locality beat the coordinate bucket", async () => {
      // Arrange
      const first = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1, padronLocality: "TRINIDAD", lat: -33.46, lng: -56.73 });
      const second = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2, padronLocality: "TRINIDAD", lat: -33.01, lng: -56.73 });
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 3, padronLocality: "ISMAEL CORTINAS", lat: -33.46, lng: -56.73 });

      // Act
      const rows = await analyze(database, ALL_GROUPS);

      // Assert
      expect(urnsOf(rows).sort()).toEqual([first, second].sort());
    });

    it("should use the tighter 3-decimal bucket when there is no padron", async () => {
      // Arrange
      const common = { padron: null, typePadron: null, streetName: "ARTIGAS", number: "10" };
      await insertAddress(database, { ...common, fuente: Fuente.ANTEL, idNumber: 1, lat: -33.4601, lng: -56.7301 });
      await insertAddress(database, { ...common, fuente: Fuente.ANTEL, idNumber: 2, lat: -33.4651, lng: -56.7301 });

      // Act
      const rows = await analyze(database, ALL_GROUPS);

      // Assert
      expect(rows).toEqual([]);
    });

    it("should never group rows that have neither padron nor street name", async () => {
      // Arrange
      for (let index = 1; index <= 3; index += 1) {
        await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: index, padron: null, typePadron: null, streetName: null });
      }

      // Act
      const rows = await analyze(database, ALL_GROUPS);

      // Assert
      expect(rows).toEqual([]);
    });

    it("should still evaluate the infra match of a row with no key anchor without grouping it", async () => {
      // Arrange
      const urn = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1, padron: null, typePadron: null, streetName: null });
      await markMatchedInServCto(database, urn);

      // Act
      const rows = await analyze(database, ALL_GROUPS);

      // Assert
      expect(rows).toEqual([]);
    });
  });

  describe("placeholder equivalence", () => {
    const PLACEHOLDERS: ReadonlyArray<string | null> = [null, "", "N/A", "S/N", "SN", "0", " n/a "];
    const FIELDS = ["number", "letter", "square", "sandlot"] as const;

    it.each(FIELDS)("should treat every placeholder in %s as the same none value", async (field) => {
      // Arrange
      const urns: string[] = [];
      for (const [index, placeholder] of PLACEHOLDERS.entries()) {
        urns.push(
          await insertAddress(database, {
            fuente: Fuente.ANTEL,
            idNumber: index + 1,
            streetName: "ARTIGAS",
            padron: null,
            typePadron: null,
            number: "5",
            [field]: placeholder,
          })
        );
      }

      // Act
      const rows = await analyze(database, ALL_GROUPS);

      // Assert
      expect(urnsOf(rows).sort()).toEqual([...urns].sort());
      expect(new Set(rows.map((row) => row.group_id)).size).toBe(1);
    });

    it.each(["letter", "square", "sandlot"] as const)("should treat a real %s as a distinguishing value", async (field) => {
      // Arrange
      const common = { streetName: "ARTIGAS", padron: null, typePadron: null, number: "5" };
      await insertAddress(database, { ...common, fuente: Fuente.ANTEL, idNumber: 1, [field]: "BIS" });
      await insertAddress(database, { ...common, fuente: Fuente.ANTEL, idNumber: 2, [field]: null });

      // Act
      const rows = await analyze(database, ALL_GROUPS);

      // Assert
      expect(rows).toEqual([]);
    });
  });

  describe("decision branches", () => {
    it("should keep an IDE row as PROTECTED_SOURCE even inside a group of five", async () => {
      // Arrange
      const ide = await insertAddress(database, { fuente: Fuente.IDE, idNumber: 1 });
      for (let index = 1; index <= 4; index += 1) {
        await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 100 + index });
      }

      // Act
      const rows = await analyze(database, ALL_GROUPS);

      // Assert
      expect(rows).toHaveLength(5);
      expect(findRow(rows, ide)).toMatchObject({
        decision: Decision.KEEP,
        decision_reason: DecisionReason.PROTECTED_SOURCE,
      });
    });

    it.each([
      ["direcciones_tlk_serv_cto_cgeo", markMatchedInServCto],
      ["nap_physical_device", markMatchedInNapDevice],
    ])("should keep a row matched in %s as INFRA_MATCHED and remove its unmatched sibling", async (_table, markMatched) => {
      // Arrange
      const matched = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 900 });
      const sibling = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
      await markMatched(database, matched);

      // Act
      const rows = await analyze(database);

      // Assert
      expect(findRow(rows, matched)).toMatchObject({
        decision: Decision.KEEP,
        decision_reason: DecisionReason.INFRA_MATCHED,
      });
      expect(findRow(rows, sibling)).toMatchObject({
        decision: Decision.REMOVE,
        decision_reason: DecisionReason.REDUNDANT_WITH_MATCHED,
        n_matched_in_group: 1,
      });
    });

    it("should expose the matched flag of each infra table separately", async () => {
      // Arrange
      const viaServCto = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
      const viaNap = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });
      await markMatchedInServCto(database, viaServCto);
      await markMatchedInNapDevice(database, viaNap);

      // Act
      const rows = await analyze(database, ALL_GROUPS);

      // Assert
      expect(findRow(rows, viaServCto)).toMatchObject({ matched_serv_cto_tlk: true, matched_nap_physical_device: false });
      expect(findRow(rows, viaNap)).toMatchObject({ matched_serv_cto_tlk: false, matched_nap_physical_device: true });
    });

    it("should remove unmatched ANTEL and TLK siblings of a matched member as REDUNDANT_WITH_MATCHED", async () => {
      // Arrange
      const matched = await insertAddress(database, { fuente: Fuente.TLK, idNumber: 50 });
      const antelSibling = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
      const tlkSibling = await insertAddress(database, { fuente: Fuente.TLK, idNumber: 2 });
      await markMatchedInServCto(database, matched);

      // Act
      const rows = await analyze(database);

      // Assert
      for (const sibling of [antelSibling, tlkSibling]) {
        expect(findRow(rows, sibling)).toMatchObject({
          decision: Decision.REMOVE,
          decision_reason: DecisionReason.REDUNDANT_WITH_MATCHED,
        });
      }
    });

    it("should keep the lowest urn number when nothing matched, ordering numerically (999 before 1000)", async () => {
      // Arrange
      const lower = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 999 });
      const higher = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1000 });

      // Act
      const rows = await analyze(database);

      // Assert
      expect(findRow(rows, lower)).toMatchObject({
        decision: Decision.KEEP,
        decision_reason: DecisionReason.LOWEST_URN_KEPT,
        pool_rank_in_group: 1,
      });
      expect(findRow(rows, higher)).toMatchObject({
        decision: Decision.REMOVE,
        decision_reason: DecisionReason.REDUNDANT_NOT_LOWEST_URN,
        pool_rank_in_group: 2,
      });
    });

    it("should keep the lowest urn across ANTEL and TLK when none matched", async () => {
      // Arrange
      const antel = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2000 });
      const tlk = await insertAddress(database, { fuente: Fuente.TLK, idNumber: 1500 });

      // Act
      const rows = await analyze(database);

      // Assert
      expect(findRow(rows, tlk).decision).toBe(Decision.KEEP);
      expect(findRow(rows, antel).decision).toBe(Decision.REMOVE);
    });

    it("should keep both members when two are matched", async () => {
      // Arrange
      const first = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
      const second = await insertAddress(database, { fuente: Fuente.TLK, idNumber: 2 });
      await markMatchedInServCto(database, first);
      await markMatchedInNapDevice(database, second);

      // Act
      const rows = await analyze(database, ALL_GROUPS);

      // Assert
      expect(rows.map((row) => row.decision)).toEqual([Decision.KEEP, Decision.KEEP]);
      expect(rows.map((row) => row.decision_reason)).toEqual([
        DecisionReason.INFRA_MATCHED,
        DecisionReason.INFRA_MATCHED,
      ]);
    });

    it("should never output a singleton, matched or not, so NO_DUPLICATE never reaches the output", async () => {
      // Arrange
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1, padron: "1" });
      const matched = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2, padron: "2" });
      await markMatchedInServCto(database, matched);

      // Act
      const removalRows = await analyze(database);
      const allRows = await analyze(database, ALL_GROUPS);

      // Assert
      expect(removalRows).toEqual([]);
      expect(allRows).toEqual([]);
    });
  });

  describe("protected sibling beside a lone removable row", () => {
    async function arrangeIdeWithLoneAntel(): Promise<{ ide: string; antel: string }> {
      const ide = await insertAddress(database, { fuente: Fuente.IDE, idNumber: 1 });
      const antel = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });
      return { ide, antel };
    }

    it("should keep the ANTEL as KEPT_ALONGSIDE_PROTECTED and list the group under ALL_DUPLICATE_GROUPS", async () => {
      // Arrange
      const { antel } = await arrangeIdeWithLoneAntel();

      // Act
      const rows = await analyze(database, ALL_GROUPS);

      // Assert
      expect(rows).toHaveLength(2);
      expect(findRow(rows, antel)).toMatchObject({
        decision: Decision.KEEP,
        decision_reason: DecisionReason.KEPT_ALONGSIDE_PROTECTED,
      });
    });

    it("should list a KEPT_ALONGSIDE_PROTECTED-only group under the default REMOVAL_GROUPS scope", async () => {
      // Arrange
      const { ide, antel } = await arrangeIdeWithLoneAntel();

      // Act
      const rows = await analyze(database, { scope: DedupScope.REMOVAL_GROUPS });

      // Assert
      expect(rows).toHaveLength(2);
      expect(rows.some((row) => row.decision === Decision.REMOVE)).toBe(false);
      expect(findRow(rows, antel).decision_reason).toBe(DecisionReason.KEPT_ALONGSIDE_PROTECTED);
      expect(findRow(rows, ide).decision_reason).toBe(DecisionReason.PROTECTED_SOURCE);
    });

    it.each([DedupScope.REMOVAL_GROUPS, DedupScope.ALL_DUPLICATE_GROUPS])(
      "should remove the ANTEL as REDUNDANT_WITH_PROTECTED and list the group when the toggle is on (%s)",
      async (scope) => {
        // Arrange
        const { ide, antel } = await arrangeIdeWithLoneAntel();

        // Act
        const rows = await analyze(database, { protectedSiblingRemovesLone: true, scope });

        // Assert
        expect(findRow(rows, antel)).toMatchObject({
          decision: Decision.REMOVE,
          decision_reason: DecisionReason.REDUNDANT_WITH_PROTECTED,
        });
        expect(findRow(rows, ide).decision_reason).toBe(DecisionReason.PROTECTED_SOURCE);
      }
    );

    it("should keep a matched ANTEL beside an IDE row as INFRA_MATCHED even when the toggle is on", async () => {
      // Arrange
      const { antel } = await arrangeIdeWithLoneAntel();
      await markMatchedInServCto(database, antel);

      // Act
      const rows = await analyze(database, { protectedSiblingRemovesLone: true, ...ALL_GROUPS });

      // Assert
      expect(findRow(rows, antel)).toMatchObject({
        decision: Decision.KEEP,
        decision_reason: DecisionReason.INFRA_MATCHED,
      });
    });

    it("should report LOWEST_URN_KEPT, not KEPT_ALONGSIDE_PROTECTED, when the group has no protected member", async () => {
      // Arrange
      const lowest = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });

      // Act
      const rows = await analyze(database, { protectedSiblingRemovesLone: true });

      // Assert
      expect(findRow(rows, lowest).decision_reason).toBe(DecisionReason.LOWEST_URN_KEPT);
    });
  });

  describe("output scope", () => {
    it("should include all-KEEP groups under ALL_DUPLICATE_GROUPS that REMOVAL_GROUPS omits", async () => {
      // Arrange
      const first = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
      const second = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });
      await markMatchedInServCto(database, first);
      await markMatchedInServCto(database, second);

      // Act
      const removalRows = await analyze(database, { scope: DedupScope.REMOVAL_GROUPS });
      const allRows = await analyze(database, ALL_GROUPS);

      // Assert
      expect(removalRows).toEqual([]);
      expect(urnsOf(allRows).sort()).toEqual([first, second].sort());
    });

    it("should list a REMOVE group under both scopes and number groups from 1", async () => {
      // Arrange
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });

      // Act
      const removalRows = await analyze(database, { scope: DedupScope.REMOVAL_GROUPS });
      const allRows = await analyze(database, ALL_GROUPS);

      // Assert
      expect(removalRows).toHaveLength(2);
      expect(allRows).toHaveLength(2);
      expect(removalRows[0].group_id).toBe(1);
    });

    it("should never output singletons under either scope", async () => {
      // Arrange
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1, padron: "1" });
      await insertAddress(database, { fuente: Fuente.IDE, idNumber: 2, padron: "2" });

      // Act
      const removalRows = await analyze(database, { scope: DedupScope.REMOVAL_GROUPS });
      const allRows = await analyze(database, ALL_GROUPS);

      // Assert
      expect(removalRows).toEqual([]);
      expect(allRows).toEqual([]);
    });
  });

  describe("parameter binding", () => {
    it("should exclude rows of another province", async () => {
      // Arrange
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1, idProvince: 7 });
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2, idProvince: 8 });

      // Act
      const provinceSeven = await analyze(database, { ...ALL_GROUPS, provinceId: 7 });
      const provinceEight = await analyze(database, { ...ALL_GROUPS, provinceId: 8 });

      // Assert: the pair shares a key, so only the filter keeps it from forming a group.
      expect(provinceSeven).toEqual([]);
      expect(provinceEight).toEqual([]);
    });

    it("should exclude rows whose source is not in the detection list and honour a changed list", async () => {
      // Arrange
      const otherSource = "OTRA";
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
      await insertAddress(database, { fuente: otherSource, idNumber: 2 });

      // Act
      const defaultSources = await analyze(database, ALL_GROUPS);
      const widenedSources = await analyze(database, {
        ...ALL_GROUPS,
        detectionFuentes: [...DEFAULT_PARAMETERS.detectionFuentes, otherSource],
      });

      // Assert
      expect(defaultSources).toEqual([]);
      expect(widenedSources).toHaveLength(2);
    });

    it("should exclude rows of a source absent from detectionFuentes even when they would form a group", async () => {
      // Arrange
      const ide = await insertAddress(database, { fuente: Fuente.IDE, idNumber: 1 });
      const antel = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });
      const tlk = await insertAddress(database, { fuente: Fuente.TLK, idNumber: 3 });

      // Act
      const rows = await analyze(database, {
        ...ALL_GROUPS,
        detectionFuentes: [Fuente.ANTEL, Fuente.TLK],
      });

      // Assert
      expect(urnsOf(rows)).not.toContain(ide);
      expect(urnsOf(rows)).toEqual(expect.arrayContaining([antel, tlk]));
    });

    it("should exclude rows whose document type is not PARENT", async () => {
      // Arrange
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2, documentType: "CHILD" });

      // Act
      const rows = await analyze(database, ALL_GROUPS);

      // Assert
      expect(rows).toEqual([]);
    });

    it("should honour changed removable and protected fuente lists", async () => {
      // Arrange
      const ide = await insertAddress(database, { fuente: Fuente.IDE, idNumber: 1 });
      const antel = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });

      // Act
      const rows = await analyze(database, {
        removableFuentes: [Fuente.IDE],
        protectedFuentes: [Fuente.ANTEL],
        ...ALL_GROUPS,
      });

      // Assert
      expect(findRow(rows, antel).decision_reason).toBe(DecisionReason.PROTECTED_SOURCE);
      expect(findRow(rows, ide).decision_reason).toBe(DecisionReason.KEPT_ALONGSIDE_PROTECTED);
    });

    it("should honour changed geo decimals when padron is present", async () => {
      // Arrange
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1, lat: -33.461, lng: -56.73 });
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2, lat: -33.469, lng: -56.73 });

      // Act
      const coarse = await analyze(database, { ...ALL_GROUPS, geoDecimalsWithPadron: 1 });
      const fine = await analyze(database, { ...ALL_GROUPS, geoDecimalsWithPadron: 3 });

      // Assert
      expect(coarse).toHaveLength(2);
      expect(fine).toEqual([]);
    });
  });

  describe("output order and shape", () => {
    it("should order a group non-REMOVE first, then by fuente, then by urn", async () => {
      // Arrange
      await insertAddress(database, { fuente: Fuente.IDE, idNumber: 700 });
      await insertAddress(database, { fuente: Fuente.TLK, idNumber: 5 });
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 30 });
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 20 });
      await insertAddress(database, { fuente: Fuente.TLK, idNumber: 40 });

      // Act
      const rows = await analyze(database);

      // Assert
      expect(urnsOf(rows)).toEqual([
        urnOf(Fuente.IDE, 700),
        urnOf(Fuente.TLK, 5),
        urnOf(Fuente.ANTEL, 20),
        urnOf(Fuente.ANTEL, 30),
        urnOf(Fuente.TLK, 40),
      ]);
      expect(rows.map((row) => row.decision)).toEqual([
        Decision.KEEP,
        Decision.KEEP,
        Decision.REMOVE,
        Decision.REMOVE,
        Decision.REMOVE,
      ]);
    });

    it("should return numeric fields as numbers and coordinates intact", async () => {
      // Arrange
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });

      // Act
      const [first] = await analyze(database);

      // Assert
      expect(typeof first.group_id).toBe("number");
      expect(typeof first.dup_group_size).toBe("number");
      expect(first.lat).toBe(DEFAULT_LAT);
      expect(first.lng).toBe(DEFAULT_LNG);
    });
  });

  describe("match key columns in the output", () => {
    it("should expose the province code from the source row", async () => {
      // Arrange
      const urn = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });

      // Act
      const rows = await analyze(database);

      // Assert
      expect(findRow(rows, urn).province_code).toBe("UY-FL");
    });

    it("should expose the padron locality, and use it as the effective segment when present", async () => {
      // Arrange
      const urn = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1, padronLocality: "TRINIDAD" });
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2, padronLocality: "TRINIDAD" });

      // Act
      const row = findRow(await analyze(database), urn);

      // Assert
      expect(row.padron_locality).toBe("TRINIDAD");
      expect(row.padron_locality_or_geo).toBe("TRINIDAD");
    });

    it("should fall back to a geo bucket with the with-padron decimals when padron_locality is missing", async () => {
      // Arrange
      const urn = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });

      // Act
      const row = findRow(await analyze(database), urn);

      // Assert
      expect(row.padron_locality).toBeNull();
      expect(row.padron_locality_or_geo).toBe("GEO:-33.46,-56.73");
    });

    it("should fall back to a geo bucket with the without-padron decimals when there is no padron", async () => {
      // Arrange
      const urn = await insertAddress(database, {
        fuente: Fuente.ANTEL,
        idNumber: 1,
        padron: null,
        streetName: "ARTIGAS",
      });
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2, padron: null, streetName: "ARTIGAS" });

      // Act
      const row = findRow(await analyze(database), urn);

      // Assert
      expect(row.padron_locality_or_geo).toBe("GEO:-33.462,-56.731");
    });

    it("should follow the geo decimals parameter in the exposed segment", async () => {
      // Arrange
      const urn = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });

      // Act
      const row = findRow(await analyze(database, { geoDecimalsWithPadron: 1 }), urn);

      // Assert
      expect(row.padron_locality_or_geo).toBe("GEO:-33.5,-56.7");
    });

    it("should give every member of a group the same match key and distinct groups distinct keys", async () => {
      // Arrange
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1, padron: "100" });
      await insertAddress(database, { fuente: Fuente.TLK, idNumber: 2, padron: " 100 " });
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 3, padron: "200" });
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 4, padron: "200" });

      // Act
      const rows = await analyze(database);
      const keysByGroup = new Map<number, Set<string>>();
      for (const row of rows) {
        keysByGroup.set(row.group_id, (keysByGroup.get(row.group_id) ?? new Set<string>()).add(row.match_key));
      }
      const distinctKeys = new Set([...keysByGroup.values()].map((keys) => [...keys][0]));

      // Assert
      expect(keysByGroup.size).toBe(2);
      for (const keys of keysByGroup.values()) expect(keys.size).toBe(1);
      expect(distinctKeys.size).toBe(2);
    });

    it("should embed the upper-cased effective segment in the match key", async () => {
      // Arrange
      const urn = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1, padronLocality: "trinidad" });
      await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2, padronLocality: "TRINIDAD" });

      // Act
      const row = findRow(await analyze(database), urn);

      // Assert
      expect(row.match_key.split("|")[5]).toBe("TRINIDAD");
    });
  });
});

describe("duplicateAnalysisQuery internal units", () => {
  it("should turn a REDUNDANT_NOT_LOWEST_URN row with internal units into HAS_INTERNAL_UNITS / KEEP", async () => {
    // Arrange
    await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
    const redundant = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });
    await markHasInternalUnits(database, redundant);

    // Act
    const rows = await analyze(database, ALL_GROUPS);

    // Assert
    expect(findRow(rows, redundant)).toMatchObject({
      decision: Decision.KEEP,
      decision_reason: DecisionReason.HAS_INTERNAL_UNITS,
      has_internal_units: true,
    });
  });

  it("should turn a REDUNDANT_WITH_MATCHED row with internal units into HAS_INTERNAL_UNITS / KEEP", async () => {
    // Arrange
    const matched = await insertAddress(database, { fuente: Fuente.TLK, idNumber: 1 });
    const redundant = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });
    await markMatchedInServCto(database, matched);
    await markHasInternalUnits(database, redundant);

    // Act
    const rows = await analyze(database, ALL_GROUPS);

    // Assert
    expect(findRow(rows, redundant)).toMatchObject({
      decision: Decision.KEEP,
      decision_reason: DecisionReason.HAS_INTERNAL_UNITS,
    });
    expect(findRow(rows, matched).decision_reason).toBe(DecisionReason.INFRA_MATCHED);
  });

  it("should turn a REDUNDANT_WITH_PROTECTED row with internal units into HAS_INTERNAL_UNITS / KEEP", async () => {
    // Arrange
    await insertAddress(database, { fuente: Fuente.IDE, idNumber: 1 });
    const antel = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });
    await markHasInternalUnits(database, antel);

    // Act
    const rows = await analyze(database, { protectedSiblingRemovesLone: true, ...ALL_GROUPS });

    // Assert
    expect(findRow(rows, antel)).toMatchObject({
      decision: Decision.KEEP,
      decision_reason: DecisionReason.HAS_INTERNAL_UNITS,
    });
  });

  it("should keep NO_DUPLICATE for a lone row with internal units", async () => {
    // Arrange
    const lone = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
    await markHasInternalUnits(database, lone);
    const widenedSql = DUPLICATE_ANALYSIS_SQL.replace("dup_group_size > 1", "true");
    expect(widenedSql).not.toBe(DUPLICATE_ANALYSIS_SQL);

    // Act
    const result = await database.query<Record<string, unknown>>(widenedSql, toQueryValues({ ...DEFAULT_PARAMETERS, ...ALL_GROUPS }));
    const rows = result.rows.map(mapAnalysisRow);

    // Assert
    expect(findRow(rows, lone)).toMatchObject({
      dup_group_size: 1,
      decision: Decision.KEEP,
      decision_reason: DecisionReason.NO_DUPLICATE,
      has_internal_units: true,
    });
  });

  it("should keep INFRA_MATCHED when a matched row also has internal units", async () => {
    // Arrange
    await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
    const matched = await insertAddress(database, { fuente: Fuente.TLK, idNumber: 2 });
    await markMatchedInServCto(database, matched);
    await markHasInternalUnits(database, matched);

    // Act
    const rows = await analyze(database, ALL_GROUPS);

    // Assert
    expect(findRow(rows, matched)).toMatchObject({
      decision_reason: DecisionReason.INFRA_MATCHED,
      has_internal_units: true,
    });
  });

  it("should keep PROTECTED_SOURCE for a protected row with internal units", async () => {
    // Arrange
    const ide = await insertAddress(database, { fuente: Fuente.IDE, idNumber: 1 });
    await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });
    await markHasInternalUnits(database, ide);

    // Act
    const rows = await analyze(database, ALL_GROUPS);

    // Assert
    expect(findRow(rows, ide)).toMatchObject({
      decision_reason: DecisionReason.PROTECTED_SOURCE,
      has_internal_units: true,
    });
  });

  it("should keep LOWEST_URN_KEPT for the kept row even when it has internal units", async () => {
    // Arrange
    const lowest = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
    const redundant = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });
    await markHasInternalUnits(database, lowest);

    // Act
    const rows = await analyze(database, ALL_GROUPS);

    // Assert
    expect(findRow(rows, lowest).decision_reason).toBe(DecisionReason.LOWEST_URN_KEPT);
    expect(findRow(rows, redundant)).toMatchObject({
      decision: Decision.REMOVE,
      has_internal_units: false,
    });
  });

  it("should list a group with no REMOVE row because every removable member is HAS_INTERNAL_UNITS under the default REMOVAL_GROUPS scope", async () => {
    // Arrange
    const lowest = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
    const firstWithUnits = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });
    const secondWithUnits = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 3 });
    await markHasInternalUnits(database, firstWithUnits);
    await markHasInternalUnits(database, secondWithUnits);

    // Act
    const rows = await analyze(database, { scope: DedupScope.REMOVAL_GROUPS });

    // Assert
    expect(rows.some((row) => row.decision === Decision.REMOVE)).toBe(false);
    expect(urnsOf(rows).sort()).toEqual([lowest, firstWithUnits, secondWithUnits].sort());
    expect(findRow(rows, firstWithUnits).decision_reason).toBe(DecisionReason.HAS_INTERNAL_UNITS);
    expect(findRow(rows, secondWithUnits).decision_reason).toBe(DecisionReason.HAS_INTERNAL_UNITS);
  });

  it("should leave has_internal_units false for every urn never marked", async () => {
    // Arrange
    const marked = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 1 });
    const other = await insertAddress(database, { fuente: Fuente.ANTEL, idNumber: 2 });
    const third = await insertAddress(database, { fuente: Fuente.TLK, idNumber: 3 });
    await markHasInternalUnits(database, marked);

    // Act
    const rows = await analyze(database, ALL_GROUPS);

    // Assert
    expect(findRow(rows, marked).has_internal_units).toBe(true);
    expect(findRow(rows, other).has_internal_units).toBe(false);
    expect(findRow(rows, third).has_internal_units).toBe(false);
  });
});
