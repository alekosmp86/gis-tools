import { describe, expect, it } from "vitest";
import { PAIR_TIER } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import { MAP_CANDIDATE_TYPES } from "@/core/constants/mapConstants";
import type { AmbiguousGroupView, PairCandidateView } from "@/modules/routine-jobs/ui/pairChoices";
import { pairChoiceKeyId } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/pairChoiceKey";
import { subjectOfAmbiguousGroup } from "@/modules/routine-jobs/ui/padronMapSubject";

const RURAL_KEY = { typePadron: "RURAL", provinceId: 6, localityId: null, number: "501" };
const URBANO_KEY = { typePadron: "URBANO", provinceId: 6, localityId: 120, number: "501" };

const candidateOf = (index: number): PairCandidateView => ({
  oldId: 500 + index,
  oldType: "URBANO",
  oldLocality: "CENTRO",
  oldNumber: String(200 + index),
  tier: PAIR_TIER.LOOSE,
  overlap: 0.93,
  areaRatio: 1.03,
});

const groupOf = (key: AmbiguousGroupView["key"], candidateCount: number): AmbiguousGroupView => ({
  id: pairChoiceKeyId(key),
  key,
  department: "MONTEVIDEO",
  locality: key.localityId === null ? null : "CENTRO",
  candidates: Array.from({ length: candidateCount }, (_unused, index) => candidateOf(index)),
});

describe("subjectOfAmbiguousGroup", () => {
  it("should title the subject as an ambiguous group and list the new padron first, then each candidate", () => {
    const subject = subjectOfAmbiguousGroup(groupOf(RURAL_KEY, 2));

    expect(subject.title).toBe("Grupo ambiguo: elija el padrón anterior");
    expect(subject.outlines.map((outline) => outline.label)).toEqual([
      "RURAL 501 · nuevo",
      "URBANO 200 · candidato 1 (id 500)",
      "URBANO 201 · candidato 2 (id 501)",
    ]);
  });

  it("should give each candidate its own item by old id, and the new padron its staging key", () => {
    const subject = subjectOfAmbiguousGroup(groupOf(RURAL_KEY, 2));

    expect(subject.items).toEqual([
      { staging: { typePadron: "RURAL", department: "MONTEVIDEO", locality: null, number: "501" } },
      { oldId: 500 },
      { oldId: 501 },
    ]);
  });

  it("should keep the items and the outlines parallel", () => {
    const subject = subjectOfAmbiguousGroup(groupOf(URBANO_KEY, 3));

    expect(subject.items).toHaveLength(subject.outlines.length);
  });

  it("should colour each candidate with its own map type, in candidate order, and give the new padron no colour type", () => {
    const subject = subjectOfAmbiguousGroup(groupOf(RURAL_KEY, 2));

    expect(subject.outlines[0].mapType).toBeUndefined();
    expect(subject.outlines[1].mapType).toBe(MAP_CANDIDATE_TYPES[0]);
    expect(subject.outlines[2].mapType).toBe(MAP_CANDIDATE_TYPES[1]);
  });

  it("should draw at most five candidates, the colour limit, and drop the sixth", () => {
    const subject = subjectOfAmbiguousGroup(groupOf(RURAL_KEY, 6));

    expect(subject.items).toHaveLength(1 + 5);
    expect(subject.items[subject.items.length - 1]).toEqual({ oldId: 504 });
    expect(subject.items).not.toContainEqual({ oldId: 505 });
  });

  it("should give a candidate outline no Catastro search, and the new padron outline its staging key as the search", () => {
    const subject = subjectOfAmbiguousGroup(groupOf(RURAL_KEY, 1));

    expect(subject.outlines[0].catastro).toEqual([{ typePadron: "RURAL", department: "MONTEVIDEO", locality: null, number: "501" }]);
    expect(subject.outlines[1].catastro).toEqual([]);
  });

  it("should omit the new padron outline when its key cannot name a staging row, as an URBANO key without locality", () => {
    const group: AmbiguousGroupView = { ...groupOf(URBANO_KEY, 1), locality: null };

    const subject = subjectOfAmbiguousGroup(group);

    expect(subject.items).toEqual([{ oldId: 500 }]);
    expect(subject.outlines.map((outline) => outline.label)).toEqual(["URBANO 200 · candidato 1 (id 500)"]);
  });
});
