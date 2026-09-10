import type { Page } from "@playwright/test";
import { expect } from "./testFixture";

export interface ConnectDbOptions {
  database?: string;
  user?: string;
  table?: string;
}

/**
 * Fills the database connection form and triggers connection & column inspection.
 */
export async function connectDb(
  page: Page,
  options: ConnectDbOptions = {}
): Promise<void> {
  const database = options.database ?? "sig_db";
  const user = options.user ?? "postgres";
  const table = options.table ?? "parcelas_catastro";

  await page.getByLabel("Nombre de Base de Datos").fill(database);
  await page.getByLabel("Usuario").fill(user);
  await page.getByLabel("Nombre de la Tabla").fill(table);

  await page.getByRole("button", { name: "Conectar y Obtener Columnas" }).click();
  await expect(page.getByText("Conexión establecida con éxito")).toBeVisible();
}
