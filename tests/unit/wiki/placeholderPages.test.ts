import { describe, it } from "vitest";
import { expectPlaceholderIndexPage } from "./placeholderAssertions";

const PLACEHOLDER_SLUGS = ["file-viewer", "db-table-viewer"];

describe("placeholder wiki pages (legacy tools without real content yet; remove a slug here once it gets real pages)", () => {
  it.each(PLACEHOLDER_SLUGS)("should render %s/index as a Nota callout saying En construcción", async (slug) => {
    await expectPlaceholderIndexPage(slug);
  });
});
