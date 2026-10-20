import { describe, it } from "vitest";
import { expectPlaceholderIndexPage } from "../../wiki/placeholderAssertions";

describe("cartography-watcher wiki placeholder (replace this file with a content test once the module gets real pages)", () => {
  it("should render cartography-watcher/index as a Nota callout saying En construcción", async () => {
    await expectPlaceholderIndexPage("cartography-watcher");
  });
});
