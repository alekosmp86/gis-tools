import { describe, expect, it } from "vitest";
import { PAIR_STATUS, PAIR_TIER, REPLACEMENT_CLASS, GEOMETRY_STATE } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import { pairChoiceKeyId } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/pairChoiceKey";
import type {
  ActualizarTargetReport,
  MissingPadron,
  PadronGeometryChange,
  PadronNamedKey,
  PadronPair,
  PairChoice,
} from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { AmbiguousGroupView } from "@/modules/routine-jobs/ui/pairChoices";
import type { PairRowView, PairView } from "@/modules/routine-jobs/ui/actualizarPadronReportView";
import { missingReviewViewOf } from "@/modules/routine-jobs/ui/missingPadronView";
import { subjectOfGeometryChange, subjectOfPair } from "@/modules/routine-jobs/ui/padronMapSubject";
import {
  geometryReviewItemsOf,
  groupReviewItemsOf,
  missingReviewItemsOf,
  pairReviewItemsOf,
  REVIEW_KIND,
} from "@/modules/routine-jobs/ui/padronReviewItems";

const newKeyOf = (overrides: Partial<PadronNamedKey> = {}): PadronNamedKey => ({
  typePadron: "RURAL",
  provinceId: 6,
  localityId: 120,
  number: "100",
  department: "Dpto Norte",
  locality: "Localidad Uno",
  ...overrides,
});

const oldKeyOf = (overrides: Partial<PadronNamedKey> = {}): PadronNamedKey => ({
  typePadron: "URBANO",
  provinceId: 6,
  localityId: 120,
  number: "90",
  department: "Dpto Norte",
  locality: "Localidad Uno",
  ...overrides,
});

const pairOf = (overrides: Partial<PadronPair> = {}): PadronPair => ({
  status: PAIR_STATUS.APPLIED,
  tier: PAIR_TIER.STRICT,
  changes: [],
  oldId: 1,
  old: oldKeyOf(),
  new: newKeyOf(),
  overlap: 0.99,
  areaRatio: 1,
  oldAreaM2: 100,
  newAreaM2: 100,
  areaChangePct: 0,
  centroidLat: -34.9,
  centroidLon: -56.2,
  ...overrides,
});

const pairRowOf = (pair: PadronPair, pending: boolean, choice: PairChoice | null): PairRowView => ({
  // The review items read only pending, choice and subject; the table view is not part of the mapping under test.
  view: null as unknown as PairView,
  pending,
  choice,
  subject: subjectOfPair(pair),
});

const geometryChangeOf = (overrides: Partial<PadronGeometryChange> = {}): PadronGeometryChange => ({
  typePadron: "URBANO",
  provinceId: 6,
  localityId: 120,
  number: "200",
  department: "Dpto Norte",
  locality: "Localidad Uno",
  oldId: 7,
  state: GEOMETRY_STATE.PENDING,
  oldAreaM2: 10000,
  newAreaM2: 10700,
  areaChangePct: 6.5,
  centroidLat: -34.9,
  centroidLon: -56.2,
  ...overrides,
});

const missingPadronOf = (overrides: Partial<MissingPadron> = {}): MissingPadron => ({
  oldId: 500,
  typePadron: "URBANO",
  provinceId: 6,
  department: "Dpto Norte",
  locality: "Localidad Uno",
  number: "90",
  oldAreaM2: 10000,
  centroidLat: -34.9,
  centroidLon: -56.2,
  class: REPLACEMENT_CLASS.REPLACED_ONE,
  coveredPct: 95,
  parts: ["RURAL 100 (95.0 %)"],
  removalReason: null,
  ...overrides,
});

const targetOf = (missingReview: MissingPadron[]): ActualizarTargetReport => ({
  table: "carto.padron_tmp_actualizacion",
  schema: "carto",
  inserted: 0,
  insertedList: [],
  updated: 0,
  updateApplied: false,
  unchanged: 0,
  unchangedWithinTolerance: 0,
  changed: 0,
  missing: missingReview.length,
  missingSamples: [],
  missingByClass: { REPLACED_ONE: missingReview.length, SUBDIVIDED: 0, PARTIAL: 0, ORPHAN: 0 },
  missingReview,
  ambiguous: 0,
  ambiguousSamples: [],
  geometryChanges: [],
  geometryPending: 0,
  pairs: [],
  pairsTotal: 0,
  pairsApplied: 0,
  pairsLoose: 0,
  pairsPending: 0,
  pairsNotApplied: 0,
  choicesUnapplied: 0,
});

const groupOf = (choice: PairChoice): AmbiguousGroupView => ({
  id: pairChoiceKeyId(choice),
  key: { typePadron: choice.typePadron, provinceId: choice.provinceId, localityId: choice.localityId, number: choice.number },
  department: "Dpto Norte",
  locality: "Localidad Uno",
  candidates: [
    {
      oldId: 1,
      oldType: "URBANO",
      oldLocality: "Localidad Uno",
      oldNumber: "90",
      tier: PAIR_TIER.STRICT,
      overlap: 0.99,
      areaRatio: 1,
    },
  ],
});

const CHOICE: PairChoice = { typePadron: "RURAL", provinceId: 6, localityId: 120, number: "100", oldId: 1 };

describe("pairReviewItemsOf", () => {
  it("should give one item per row, in row order, with the kind each row needs", () => {
    const pending = pairRowOf(pairOf({ status: PAIR_STATUS.NOT_APPLIED_PENDING, tier: PAIR_TIER.LOOSE }), true, CHOICE);
    const applied = pairRowOf(pairOf({ new: newKeyOf({ number: "300" }) }), false, null);

    const items = pairReviewItemsOf([pending, applied]);

    expect(items.map((item) => item.kind)).toEqual([REVIEW_KIND.PENDING_PAIR, REVIEW_KIND.INFO]);
  });

  it("should give a pending pair the PENDING_PAIR kind with its choice, and a null choice when it has no complete key", () => {
    const withChoice = pairRowOf(pairOf({ status: PAIR_STATUS.NOT_APPLIED_PENDING }), true, CHOICE);
    const withoutChoice = pairRowOf(pairOf({ status: PAIR_STATUS.NOT_APPLIED_PENDING }), true, null);

    const items = pairReviewItemsOf([withChoice, withoutChoice]);

    expect(items[0]).toEqual({ kind: REVIEW_KIND.PENDING_PAIR, subject: withChoice.subject, choice: CHOICE });
    expect(items[1]).toEqual({ kind: REVIEW_KIND.PENDING_PAIR, subject: withoutChoice.subject, choice: null });
  });

  it("should give an applied pair with no choice the INFO kind, carrying its map subject", () => {
    const row = pairRowOf(pairOf(), false, null);

    const items = pairReviewItemsOf([row]);

    expect(items).toEqual([{ kind: REVIEW_KIND.INFO, subject: row.subject }]);
  });

  it("should return no items for no rows", () => {
    expect(pairReviewItemsOf([])).toEqual([]);
  });
});

describe("geometryReviewItemsOf", () => {
  it("should give one GEOMETRY item per change, in order, carrying the change and its map subject", () => {
    const first = geometryChangeOf({ number: "200", oldId: 7 });
    const second = geometryChangeOf({ number: "300", oldId: 8, state: GEOMETRY_STATE.APPLIED });

    const items = geometryReviewItemsOf([first, second]);

    expect(items).toEqual([
      { kind: REVIEW_KIND.GEOMETRY, subject: subjectOfGeometryChange(first), change: first },
      { kind: REVIEW_KIND.GEOMETRY, subject: subjectOfGeometryChange(second), change: second },
    ]);
  });

  it("should return no items for no changes", () => {
    expect(geometryReviewItemsOf([])).toEqual([]);
  });
});

describe("groupReviewItemsOf", () => {
  it("should give one AMBIGUOUS item per group carrying the group", () => {
    const group = groupOf(CHOICE);

    const items = groupReviewItemsOf([group]);

    expect(items).toEqual([{ kind: REVIEW_KIND.AMBIGUOUS, subject: expect.anything(), group }]);
  });
});

describe("missingReviewItemsOf", () => {
  it("should give one MISSING item per listed padron, carrying the padron view of the review", () => {
    const view = missingReviewViewOf(targetOf([missingPadronOf({ oldId: 500 }), missingPadronOf({ oldId: 600 })]));
    if (view === null) throw new Error("expected a missing review for a target with missing padrones");

    const items = missingReviewItemsOf(view.rows);

    expect(items.map((item) => item.kind)).toEqual([REVIEW_KIND.MISSING, REVIEW_KIND.MISSING]);
    expect(items[0]).toEqual({ kind: REVIEW_KIND.MISSING, subject: view.rows[0].subject, padron: view.rows[0] });
    expect(items[1]).toMatchObject({ padron: { oldId: 600 } });
  });
});
