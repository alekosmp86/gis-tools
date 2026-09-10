import { test, expect } from "./support/testFixture";

/**
 * Basic smoke test verifying home page title and initial render offline.
 */
test.describe("GIS Tools Application Smoke Tests", () => {
  test("should verify app home page loads successfully", async ({ page, mockBackend }) => {
    await mockBackend();
    await page.goto("/");
    await expect(page).toHaveTitle("Suite de Herramientas SIG | Procesamiento Espacial");
  });
});
