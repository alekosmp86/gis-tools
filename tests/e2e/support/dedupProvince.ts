import { expect } from "./testFixture";
import type { Page } from "@playwright/test";

const PROVINCES_URL = "**/api/m/address-dedup/provinces";

export const DEDUP_PROVINCES_RESPONSE = {
  success: true,
  provinces: [
    { id: 7, name: "FLORES" },
    { id: 1, name: "MONTEVIDEO" },
  ],
};

export async function mockProvinces(page: Page, response: unknown = DEDUP_PROVINCES_RESPONSE): Promise<void> {
  await page.route(PROVINCES_URL, (route) => route.fulfill({ json: response }));
}

/** Needs the connection filled first: the load button stays disabled until database, user and password are set. */
export async function loadAndSelectProvince(page: Page, name = "FLORES"): Promise<void> {
  await page.getByRole("button", { name: "Cargar departamentos" }).click();
  const select = page.getByLabel("Departamento");
  await expect(select).toBeEnabled();
  await select.selectOption({ label: name });
}
