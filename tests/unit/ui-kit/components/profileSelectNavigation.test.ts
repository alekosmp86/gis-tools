import { describe, expect, it } from "vitest";
import {
  FIRST_PROFILE_INDEX,
  NO_HIGHLIGHT,
  highlightAfterArrow,
  highlightAfterQuery,
  resolveEnterSelection,
} from "@/ui-kit/hooks/profileSelectNavigation";
import { filterByName } from "@/core/common/filterByName";

describe("profileSelectNavigation", () => {
  it("should expose the sentinel and first-profile constants", () => {
    expect(NO_HIGHLIGHT).toBe(-1);
    expect(FIRST_PROFILE_INDEX).toBe(1);
  });

  describe("highlightAfterQuery", () => {
    it.each(["", " ", "   \t"])("should return no highlight for blank query %j", (query) => {
      expect(highlightAfterQuery(query, 5)).toBe(NO_HIGHLIGHT);
    });

    it("should highlight the first profile for a non-blank query with matches", () => {
      expect(highlightAfterQuery("dev", 2)).toBe(1);
      expect(highlightAfterQuery("dev", 1)).toBe(1);
    });

    it("should return no highlight for a non-blank query without matches", () => {
      expect(highlightAfterQuery("zzz", 0)).toBe(NO_HIGHLIGHT);
    });
  });

  describe("highlightAfterArrow", () => {
    it("should go to the first option on Down from no highlight", () => {
      expect(highlightAfterArrow(-1, "ArrowDown", 4)).toBe(0);
    });

    it("should increment on Down", () => {
      expect(highlightAfterArrow(0, "ArrowDown", 4)).toBe(1);
      expect(highlightAfterArrow(2, "ArrowDown", 4)).toBe(3);
    });

    it("should clamp Down at the last option without wrapping", () => {
      expect(highlightAfterArrow(3, "ArrowDown", 4)).toBe(3);
    });

    it("should go to the last option on Up from no highlight", () => {
      expect(highlightAfterArrow(-1, "ArrowUp", 4)).toBe(3);
    });

    it("should decrement on Up", () => {
      expect(highlightAfterArrow(3, "ArrowUp", 4)).toBe(2);
      expect(highlightAfterArrow(1, "ArrowUp", 4)).toBe(0);
    });

    it("should clamp Up at the first option without wrapping", () => {
      expect(highlightAfterArrow(0, "ArrowUp", 4)).toBe(0);
    });

    it("should stay on the only option when optionCount is 1", () => {
      expect(highlightAfterArrow(-1, "ArrowDown", 1)).toBe(0);
      expect(highlightAfterArrow(-1, "ArrowUp", 1)).toBe(0);
      expect(highlightAfterArrow(0, "ArrowDown", 1)).toBe(0);
      expect(highlightAfterArrow(0, "ArrowUp", 1)).toBe(0);
    });
  });

  describe("resolveEnterSelection", () => {
    const profiles = [{ id: "a" }, { id: "b" }, { id: "c" }];

    it("should return null when nothing is highlighted", () => {
      expect(resolveEnterSelection(-1, profiles)).toBeNull();
    });

    it("should return an empty id for the new-connection option", () => {
      expect(resolveEnterSelection(0, profiles)).toBe("");
    });

    it("should return the first profile id at index 1", () => {
      expect(resolveEnterSelection(1, profiles)).toBe("a");
    });

    it("should return the n-th profile id at index n", () => {
      expect(resolveEnterSelection(2, profiles)).toBe("b");
      expect(resolveEnterSelection(3, profiles)).toBe("c");
    });

    it("should pass ids with special characters through unchanged", () => {
      const odd = [{ id: "id/with spaces&ñ:1" }];

      expect(resolveEnterSelection(1, odd)).toBe("id/with spaces&ñ:1");
    });

    it("should return the new-connection id even when there are no profiles", () => {
      expect(resolveEnterSelection(0, [])).toBe("");
    });
  });

  describe("walk-through composing the functions like the hook", () => {
    const saved = [
      { id: "p1", name: "Dev Norte" },
      { id: "p2", name: "Dev Sur" },
      { id: "p3", name: "Producción" },
    ];

    it("should highlight, navigate and select across a typing session", () => {
      let query = "";
      let active = highlightAfterQuery(query, filterByName(saved, query).length);
      expect(active).toBe(NO_HIGHLIGHT);

      query = "dev";
      const matches = filterByName(saved, query);
      active = highlightAfterQuery(query, matches.length);
      expect(matches).toHaveLength(2);
      expect(active).toBe(1);

      active = highlightAfterArrow(active, "ArrowDown", matches.length + 1);
      expect(active).toBe(2);
      expect(resolveEnterSelection(active, matches)).toBe("p2");

      query = "";
      active = highlightAfterQuery(query, filterByName(saved, query).length);
      expect(active).toBe(NO_HIGHLIGHT);
      expect(resolveEnterSelection(active, filterByName(saved, query))).toBeNull();

      active = highlightAfterArrow(active, "ArrowUp", saved.length + 1);
      expect(active).toBe(3);
      expect(resolveEnterSelection(active, filterByName(saved, query))).toBe("p3");
    });

    it("should highlight nothing and select nothing when the query has no matches", () => {
      const matches = filterByName(saved, "zzz");

      const active = highlightAfterQuery("zzz", matches.length);

      expect(active).toBe(NO_HIGHLIGHT);
      expect(resolveEnterSelection(active, matches)).toBeNull();
    });
  });
});
