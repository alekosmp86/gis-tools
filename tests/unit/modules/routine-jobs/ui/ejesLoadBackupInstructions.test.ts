import { describe, expect, it } from "vitest";
import { EJES_LOAD_BACKUP_INSTRUCTIONS } from "@/modules/routine-jobs/ui/ejes-calles/ejesLoadTexts";

describe("EJES_LOAD_BACKUP_INSTRUCTIONS topology sentence (EJ-28)", () => {
  const sentenceOf = (fragment: string): string | undefined => EJES_LOAD_BACKUP_INSTRUCTIONS.find((line) => line.includes(fragment));

  it("should say the revert file is valid only before a later topology rebuild", () => {
    expect(sentenceOf("reconstrucción posterior de la topología")).toBe(
      "El respaldo solo sirve antes de cualquier reconstrucción posterior de la topología: un pgr_createTopology con clean := true renumera los vértices. Los vértices de ruteo creados se borran por id, por encima del máximo previo a la carga."
    );
  });

  it("should name pgr_createTopology with clean := true as the rebuild that renumbers the vertices", () => {
    expect(sentenceOf("pgr_createTopology con clean := true renumera los vértices")).toBeDefined();
  });

  it("should keep the topology sentence after the restore instructions, so the first line stays the restore procedure", () => {
    const restoreAt = EJES_LOAD_BACKUP_INSTRUCTIONS.findIndex((line) => line.startsWith("Para revertir"));
    const topologyAt = EJES_LOAD_BACKUP_INSTRUCTIONS.findIndex((line) => line.includes("reconstrucción posterior de la topología"));

    expect(restoreAt).toBe(0);
    expect(topologyAt).toBeGreaterThan(restoreAt);
  });
});
