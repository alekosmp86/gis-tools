import { test, expect } from "@playwright/test";

/**
 * Basic smoke test scaffolding for future UI / E2E test missions.
 */
test.describe("GIS Tools Application Smoke Tests", () => {
  test("should verify app home page loads successfully", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/GIS Tools/i);
  });
});
