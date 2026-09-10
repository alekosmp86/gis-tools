import type { Page } from "@playwright/test";
import { expect } from "./testFixture";

export interface ConnectDbOptions {
  database?: string;
  user?: string;
  table?: string;
}

/**
 * Fills database credentials into the connection form fields.
 */
export async function fillDbCredentials(
  page: Page,
  options: ConnectDbOptions = {}
): Promise<void> {
  const database = options.database ?? "sig_db";
  const user = options.user ?? "postgres";
  const table = options.table ?? "parcelas_catastro";

  await page.getByLabel("Nombre de Base de Datos").fill(database);
  await page.getByLabel("Usuario").fill(user);
  await page.getByLabel("Nombre de la Tabla").fill(table);
}

/**
 * Fills the database connection form and triggers connection & column inspection.
 */
export async function connectDb(
  page: Page,
  options: ConnectDbOptions = {}
): Promise<void> {
  await fillDbCredentials(page, options);
  await page.getByRole("button", { name: "Conectar y Obtener Columnas" }).click();
  await expect(page.getByText("Conexión establecida con éxito")).toBeVisible();
}

/**
 * Pinned defect characterization (D4):
 * When navigating back from Step 2 to Step 1, DbConnectionForm remounts and loses its internal
 * isConnected state. While the parent page retains canProceed=true (leaving the button enabled),
 * clicking proceed() no-ops and the wizard remains on Step 1.
 * When the shared-shell refactor fixes this defect, this helper will fail and should be updated.
 */
export async function assertStep1RemountQuirk(
  page: Page,
  options: ConnectDbOptions = {},
  expectedHeading: string | RegExp = /1\. (Conectar a Base de Datos PostgreSQL|Configurar Base de Datos Origen)/i
): Promise<void> {
  const nextToStep2 = page.getByRole("button", { name: "Continuar al Paso 2" });
  await expect(nextToStep2).toBeEnabled();
  await nextToStep2.click();
  await expect(page.getByRole("heading", { name: expectedHeading })).toBeVisible();

  // Re-connect to re-establish isConnected state in the remounted form and advance
  await connectDb(page, options);
  await nextToStep2.click();
}
