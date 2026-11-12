import { describe, expect, it } from "vitest";
import {
  getDiscrepancyColor,
  getDiscrepancyLabel,
  MAP_ROLE_TYPE,
  MAP_SECTION_TYPE,
  MAP_UNDERLAY_TYPES,
} from "@/core/constants/mapConstants";

const { COPY_KEPT, COPY_DROPPED } = MAP_SECTION_TYPE;

describe("copy decision map types (ET-15)", () => {
  it("should name the two types TRAMO_SE_QUEDA and TRAMO_SE_QUITA", () => {
    expect(COPY_KEPT).toBe("TRAMO_SE_QUEDA");
    expect(COPY_DROPPED).toBe("TRAMO_SE_QUITA");
  });

  it("should colour the kept copy blue and the dropped copy red", () => {
    expect(getDiscrepancyColor(COPY_KEPT)).toBe("#2563eb");
    expect(getDiscrepancyColor(COPY_DROPPED)).toBe("#dc2626");
  });

  it("should label them Se queda and Se quitaría for the legend", () => {
    expect(getDiscrepancyLabel(COPY_KEPT)).toBe("Se queda");
    expect(getDiscrepancyLabel(COPY_DROPPED)).toBe("Se quitaría");
  });

  it("should make the two colours distinct from each other and from every other section, zone and role colour", () => {
    const others = [
      MAP_SECTION_TYPE.OLD,
      MAP_SECTION_TYPE.NEW,
      MAP_SECTION_TYPE.URBAN_ZONE,
      MAP_SECTION_TYPE.RURAL_ZONE,
      ...Object.values(MAP_ROLE_TYPE),
    ].map((type) => getDiscrepancyColor(type).toLowerCase());
    const kept = getDiscrepancyColor(COPY_KEPT).toLowerCase();
    const dropped = getDiscrepancyColor(COPY_DROPPED).toLowerCase();

    expect(kept).not.toBe(dropped);
    expect(others).not.toContain(kept);
    expect(others).not.toContain(dropped);
  });

  it("should draw the dropped copy as an underlay, wider, and not the kept one", () => {
    expect(MAP_UNDERLAY_TYPES).toContain(COPY_DROPPED);
    expect(MAP_UNDERLAY_TYPES).not.toContain(COPY_KEPT);
  });

  it("should keep the old section as an underlay", () => {
    expect(MAP_UNDERLAY_TYPES).toContain(MAP_SECTION_TYPE.OLD);
  });
});
