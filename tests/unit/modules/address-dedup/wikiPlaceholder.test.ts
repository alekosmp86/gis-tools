import { describe, it } from "vitest";
import { expectPlaceholderIndexPage } from "../../wiki/placeholderAssertions";

describe("address-dedup wiki placeholder (replace this file with a content test once the module gets real pages)", () => {
  it("should render address-dedup/index as a Nota callout saying En construcción", async () => {
    await expectPlaceholderIndexPage("address-dedup");
  });
});
