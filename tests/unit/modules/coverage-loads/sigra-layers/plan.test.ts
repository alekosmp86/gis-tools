import { describe, expect, it } from "vitest";
import { SigraLayerId } from "@/modules/coverage-loads/sigra-layers/constants";
import { buildSigraPlan } from "@/modules/coverage-loads/sigra-layers/domain/plan";
import { getSigraLayer } from "@/modules/coverage-loads/sigra-layers/domain/layerRegistry";
import type { LayerDbState, LayerProbe, SigraDbState } from "@/modules/coverage-loads/sigra-layers/types";

const ZONAS = SigraLayerId.ZONAS_FTTH;
const LIMITE = SigraLayerId.LIMITE_CENTRAL_FTTH;
const POSTES = SigraLayerId.POSTES;

const dbLayer = (layerId: SigraLayerId, overrides: Partial<LayerDbState> = {}): LayerDbState => ({
  layerId,
  tableExists: true,
  rowCount: 100,
  lastUpdated: "2026-01-31",
  missingPrivileges: [],
  ...overrides,
});

const stateOf = (layers: LayerDbState[], overrides: Partial<SigraDbState> = {}): SigraDbState => ({
  layers,
  canCreateTemp: true,
  auditAvailable: true,
  ...overrides,
});

const probe = (layerId: SigraLayerId, numberMatched: number | null = 100, error: string | null = null): LayerProbe => ({
  layerId,
  numberMatched,
  error,
});

const labelOf = (id: SigraLayerId) => getSigraLayer(id).label;

describe("buildSigraPlan (AC-1, AC-2)", () => {
  describe("layers", () => {
    it("should list the layers in the requested order, merging registry data, database state and probe", () => {
      // Arrange
      const state = stateOf([
        dbLayer(POSTES, { rowCount: 7, lastUpdated: "2025-12-01" }),
        dbLayer(ZONAS, { rowCount: 3, lastUpdated: null }),
      ]);

      // Act
      const plan = buildSigraPlan({ layerIds: [POSTES, ZONAS], state, probes: [probe(ZONAS, 5), probe(POSTES, 8)] });

      // Assert
      expect(plan.layers).toEqual([
        {
          layerId: POSTES,
          label: labelOf(POSTES),
          required: false,
          tableExists: true,
          rowCount: 7,
          lastUpdated: "2025-12-01",
          missingPrivileges: [],
          wfsCount: 8,
          wfsError: null,
          blockers: [],
          canLoad: true,
        },
        {
          layerId: ZONAS,
          label: labelOf(ZONAS),
          required: true,
          tableExists: true,
          rowCount: 3,
          lastUpdated: null,
          missingPrivileges: [],
          wfsCount: 5,
          wfsError: null,
          blockers: [],
          canLoad: true,
        },
      ]);
    });

    it("should match probes by layer id, not by position", () => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS), dbLayer(LIMITE)]);

      // Act
      const plan = buildSigraPlan({ layerIds: [ZONAS, LIMITE], state, probes: [probe(LIMITE, 11), probe(ZONAS, 22)] });

      // Assert
      expect(plan.layers.map((layer) => [layer.layerId, layer.wfsCount])).toEqual([
        [ZONAS, 22],
        [LIMITE, 11],
      ]);
    });

    it("should treat a layer without a probe entry as not probed: no count, no error, no blocker", () => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS), dbLayer(LIMITE)]);

      // Act
      const plan = buildSigraPlan({ layerIds: [ZONAS, LIMITE], state, probes: [probe(ZONAS, 100)] });

      // Assert
      expect(plan.layers[1]).toMatchObject({ wfsCount: null, wfsError: null, blockers: [], canLoad: true });
    });

    it("should treat every layer as not probed when there are no probes (the load path)", () => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS)]);

      // Act
      const plan = buildSigraPlan({ layerIds: [ZONAS], state, probes: [] });

      // Assert
      expect(plan.layers[0]).toMatchObject({ wfsCount: null, wfsError: null });
      expect(plan.canLoad).toBe(true);
      expect(plan.warnings).toEqual([]);
    });

    it("should report a probe without a count as wfsCount null", () => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS)]);

      // Act
      const plan = buildSigraPlan({ layerIds: [ZONAS], state, probes: [probe(ZONAS, null)] });

      // Assert
      expect(plan.layers[0]).toMatchObject({ wfsCount: null, wfsError: null, canLoad: true });
    });

    it("should not mutate its input", () => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS, { missingPrivileges: ["INSERT"] })]);
      const probes = [probe(ZONAS, 5)];
      const before = JSON.stringify({ state, probes });

      // Act
      buildSigraPlan({ layerIds: [ZONAS], state, probes });

      // Assert
      expect(JSON.stringify({ state, probes })).toBe(before);
    });
  });

  describe("layer blockers (AC-2)", () => {
    it("should block a layer whose final table does not exist", () => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS, { tableExists: false, rowCount: null, lastUpdated: null }), dbLayer(LIMITE)]);

      // Act
      const plan = buildSigraPlan({ layerIds: [ZONAS, LIMITE], state, probes: [] });

      // Assert
      expect(plan.layers[0].blockers).toHaveLength(1);
      expect(plan.layers[0].blockers[0].length).toBeGreaterThan(0);
      expect(plan.layers[0].canLoad).toBe(false);
      expect(plan.layers[1]).toMatchObject({ blockers: [], canLoad: true });
      expect(plan.canLoad).toBe(false);
    });

    it("should block a layer with missing privileges in one message naming the table and every privilege", () => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS, { missingPrivileges: ["INSERT", "USAGE:public.area_zonas_ftth_f_gid_seq"] })]);

      // Act
      const plan = buildSigraPlan({ layerIds: [ZONAS], state, probes: [] });

      // Assert
      const table = getSigraLayer(ZONAS).finalTable;
      expect(plan.layers[0].canLoad).toBe(false);
      expect(
        plan.layers[0].blockers.some(
          (blocker) => blocker.includes(table) && blocker.includes("INSERT") && blocker.includes("USAGE:public.area_zonas_ftth_f_gid_seq"),
        ),
      ).toBe(true);
    });

    it("should block a layer whose WFS probe failed and keep the error on the layer", () => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS)]);

      // Act
      const plan = buildSigraPlan({ layerIds: [ZONAS], state, probes: [probe(ZONAS, null, "El WFS no responde.")] });

      // Assert
      expect(plan.layers[0]).toMatchObject({ wfsCount: null, wfsError: "El WFS no responde.", canLoad: false });
      expect(plan.layers[0].blockers).toHaveLength(1);
      expect(plan.canLoad).toBe(false);
    });

    it("should give a layer one blocker per distinct problem", () => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS, { missingPrivileges: ["DELETE"] })]);

      // Act
      const plan = buildSigraPlan({ layerIds: [ZONAS], state, probes: [probe(ZONAS, null, "caido")] });

      // Assert
      expect(plan.layers[0].blockers).toHaveLength(2);
    });

    it("should not block a layer for a failed probe of another layer", () => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS), dbLayer(LIMITE)]);

      // Act
      const plan = buildSigraPlan({ layerIds: [ZONAS, LIMITE], state, probes: [probe(ZONAS, null, "caido"), probe(LIMITE, 100)] });

      // Assert
      expect(plan.layers.map((layer) => layer.canLoad)).toEqual([false, true]);
    });
  });

  describe("global TEMP blocker", () => {
    it("should block every layer and the plan when temporary tables cannot be created", () => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS), dbLayer(LIMITE)], { canCreateTemp: false });

      // Act
      const plan = buildSigraPlan({ layerIds: [ZONAS, LIMITE], state, probes: [] });

      // Assert
      expect(plan.canLoad).toBe(false);
      for (const layer of plan.layers) {
        expect(layer.canLoad).toBe(false);
        expect(layer.blockers.length).toBeGreaterThan(0);
      }
    });

    it("should list the TEMP blocker once in the plan blockers, besides the label-prefixed copies", () => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS), dbLayer(LIMITE)], { canCreateTemp: false });

      // Act
      const plan = buildSigraPlan({ layerIds: [ZONAS, LIMITE], state, probes: [] });

      // Assert
      const tempMessage = plan.layers[0].blockers[0];
      expect(plan.blockers.filter((blocker) => blocker === tempMessage)).toHaveLength(1);
      expect(plan.blockers.filter((blocker) => blocker.includes(labelOf(ZONAS)) && blocker.includes(tempMessage))).toHaveLength(1);
      expect(plan.blockers.filter((blocker) => blocker.includes(labelOf(LIMITE)) && blocker.includes(tempMessage))).toHaveLength(1);
    });
  });

  describe("plan blockers and canLoad", () => {
    it("should prefix each per-layer blocker with the layer label and leave no duplicates", () => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS, { tableExists: false, rowCount: null }), dbLayer(POSTES, { missingPrivileges: ["DELETE"] })]);

      // Act
      const plan = buildSigraPlan({ layerIds: [ZONAS, POSTES], state, probes: [] });

      // Assert
      expect(plan.blockers).toHaveLength(2);
      expect(plan.blockers[0]).toContain(labelOf(ZONAS));
      expect(plan.blockers[0]).toContain(plan.layers[0].blockers[0]);
      expect(plan.blockers[1]).toContain(labelOf(POSTES));
      expect(new Set(plan.blockers).size).toBe(plan.blockers.length);
    });

    it("should be loadable with no blockers when every layer is fine", () => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS), dbLayer(LIMITE)]);

      // Act
      const plan = buildSigraPlan({ layerIds: [ZONAS, LIMITE], state, probes: [probe(ZONAS), probe(LIMITE)] });

      // Assert
      expect(plan).toMatchObject({ canLoad: true, blockers: [], warnings: [] });
    });

    it("should not be loadable when there are no layers", () => {
      // Arrange & Act
      const plan = buildSigraPlan({ layerIds: [], state: stateOf([]), probes: [] });

      // Assert
      expect(plan.layers).toEqual([]);
      expect(plan.canLoad).toBe(false);
    });

    it("should not be loadable when a single layer of several is blocked", () => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS), dbLayer(LIMITE), dbLayer(POSTES, { missingPrivileges: ["INSERT"] })]);

      // Act
      const plan = buildSigraPlan({ layerIds: [ZONAS, LIMITE, POSTES], state, probes: [] });

      // Assert
      expect(plan.canLoad).toBe(false);
      expect(plan.layers.map((layer) => layer.canLoad)).toEqual([true, true, false]);
    });
  });

  describe("warnings (never blocking)", () => {
    it("should warn once that the load runs without audit when the audit table is unavailable", () => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS), dbLayer(LIMITE)], { auditAvailable: false });

      // Act
      const plan = buildSigraPlan({ layerIds: [ZONAS, LIMITE], state, probes: [] });

      // Assert
      expect(plan.warnings).toHaveLength(1);
      expect(plan.warnings[0].length).toBeGreaterThan(0);
      expect(plan.canLoad).toBe(true);
      expect(plan.blockers).toEqual([]);
    });

    it("should not warn about the audit when it is available", () => {
      // Arrange & Act
      const plan = buildSigraPlan({ layerIds: [ZONAS], state: stateOf([dbLayer(ZONAS)]), probes: [] });

      // Assert
      expect(plan.warnings).toEqual([]);
    });

    it("should not warn when the WFS count is exactly 97% of the table count (the boundary)", () => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS, { rowCount: 1000 })]);

      // Act
      const plan = buildSigraPlan({ layerIds: [ZONAS], state, probes: [probe(ZONAS, 970)] });

      // Assert
      expect(plan.warnings).toEqual([]);
    });

    it("should warn with the label and both counts when the WFS count is below 97% of the table count", () => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS, { rowCount: 1000 })]);

      // Act
      const plan = buildSigraPlan({ layerIds: [ZONAS], state, probes: [probe(ZONAS, 969)] });

      // Assert
      expect(plan.warnings).toHaveLength(1);
      expect(plan.warnings[0]).toContain(labelOf(ZONAS));
      expect(plan.warnings[0]).toContain("969");
      expect(plan.warnings[0]).toContain("1000");
      expect(plan.canLoad).toBe(true);
    });

    it("should warn when the WFS returns nothing for a table that has rows", () => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS, { rowCount: 5 })]);

      // Act
      const plan = buildSigraPlan({ layerIds: [ZONAS], state, probes: [probe(ZONAS, 0)] });

      // Assert
      expect(plan.warnings).toHaveLength(1);
    });

    it("should not warn when the WFS has more rows than the table", () => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS, { rowCount: 10 })]);

      // Act
      const plan = buildSigraPlan({ layerIds: [ZONAS], state, probes: [probe(ZONAS, 500)] });

      // Assert
      expect(plan.warnings).toEqual([]);
    });

    it.each([
      ["an empty table", 0],
      ["an unreadable table", null],
    ])("should not warn about the ratio for %s", (_label, rowCount) => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS, { rowCount })]);

      // Act
      const plan = buildSigraPlan({ layerIds: [ZONAS], state, probes: [probe(ZONAS, 0)] });

      // Assert
      expect(plan.warnings).toEqual([]);
    });

    it("should not warn about the ratio for a layer that was not probed or whose probe has no count", () => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS, { rowCount: 1000 }), dbLayer(LIMITE, { rowCount: 1000 })]);

      // Act
      const plan = buildSigraPlan({ layerIds: [ZONAS, LIMITE], state, probes: [probe(LIMITE, null)] });

      // Assert
      expect(plan.warnings).toEqual([]);
    });

    it("should give one warning per offending layer plus the audit warning", () => {
      // Arrange
      const state = stateOf([dbLayer(ZONAS, { rowCount: 100 }), dbLayer(LIMITE, { rowCount: 100 }), dbLayer(POSTES, { rowCount: 100 })], {
        auditAvailable: false,
      });

      // Act
      const plan = buildSigraPlan({
        layerIds: [ZONAS, LIMITE, POSTES],
        state,
        probes: [probe(ZONAS, 50), probe(LIMITE, 100), probe(POSTES, 10)],
      });

      // Assert
      expect(plan.warnings).toHaveLength(3);
      expect(plan.warnings.filter((warning) => warning.includes(labelOf(ZONAS)))).toHaveLength(1);
      expect(plan.warnings.filter((warning) => warning.includes(labelOf(POSTES)))).toHaveLength(1);
      expect(plan.warnings.filter((warning) => warning.includes(labelOf(LIMITE)))).toHaveLength(0);
    });
  });
});
