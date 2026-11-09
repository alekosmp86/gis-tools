import type { Page } from "@playwright/test";
import { test, expect } from "../support/testFixture";
import { takeShot } from "./shot";
import { shotMain } from "./wizardShotHelpers";
import { FAKE_CONNECTION, mockActualizarPadronApi, mockCargarPadronesApi } from "./routine-jobs.mocks";

const TOOL = "routine-jobs";
const TOOL_URL = "/tools/m/routine-jobs";
const RESULT_TIMEOUT = 20_000;
const PASSWORD_LABEL = "Contraseña de la base de datos";
const CARGAR_STAGE = "Cargar padrones";
const ACTUALIZAR_STAGE = "Actualizar padrones";
const COLUMN_CHECKS_CARGAR = 3;
const COLUMN_CHECKS_ACTUALIZAR = 5;

async function shot(page: Page, name: string): Promise<void> {
  await shotMain(page, TOOL, name);
}

async function openStage(page: Page, title: string): Promise<void> {
  await page.goto(TOOL_URL);
  await page.getByRole("button", { name: "Abrir" }).click();
  await page.getByLabel("Servidor", { exact: true }).fill(FAKE_CONNECTION.host);
  await page.getByLabel("Base de datos", { exact: true }).fill(FAKE_CONNECTION.db_name);
  await page.getByLabel("Usuario", { exact: true }).fill(FAKE_CONNECTION.user);
  await page.getByLabel("Contraseña", { exact: true }).fill(FAKE_CONNECTION.password);
  await page.getByRole("button", { name: "Continuar a las etapas" }).click();
  const row = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await row.getByRole("button", { name: "Abrir" }).click();
}

async function goNext(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Continuar al Paso/ }).click();
}

async function openTables(page: Page, title: string, columnChecks: number): Promise<void> {
  await openStage(page, title);
  await expect(page.getByText("Ver columnas")).toHaveCount(columnChecks);
  await expect(page.getByText("Todas las columnas requeridas")).toHaveCount(columnChecks);
}

async function openOptions(page: Page, title: string, columnChecks: number): Promise<void> {
  await openTables(page, title, columnChecks);
  await goNext(page);
}

async function openReview(page: Page, title: string, columnChecks: number): Promise<void> {
  await openOptions(page, title, columnChecks);
  await goNext(page);
  await page.getByLabel(PASSWORD_LABEL, { exact: true }).fill(FAKE_CONNECTION.password);
}

test.describe("Wiki screenshots: routine-jobs", () => {
  test("01-padrones-tablas", async ({ page }) => {
    await mockCargarPadronesApi(page);
    await openTables(page, CARGAR_STAGE, COLUMN_CHECKS_CARGAR);
    await shot(page, "01-padrones-tablas");
  });

  test("02-padrones-opciones", async ({ page }) => {
    await mockCargarPadronesApi(page);
    await openOptions(page, CARGAR_STAGE, COLUMN_CHECKS_CARGAR);
    await expect(page.getByLabel("Reiniciar secuencias del destino")).toBeChecked();
    await shot(page, "02-padrones-opciones");
  });

  test("03-padrones-revisar", async ({ page }) => {
    await mockCargarPadronesApi(page);
    await openReview(page, CARGAR_STAGE, COLUMN_CHECKS_CARGAR);
    await expect(page.getByRole("button", { name: "Cargar ahora" })).toBeEnabled();
    await shot(page, "03-padrones-revisar");
  });

  test("04-padrones-resultado-simulacion", async ({ page }) => {
    await mockCargarPadronesApi(page);
    await openReview(page, CARGAR_STAGE, COLUMN_CHECKS_CARGAR);
    await page.getByRole("button", { name: "Analizar sin cargar" }).click();
    await expect(page.getByText("Simulación: no se modificó la tabla destino.")).toBeVisible({ timeout: RESULT_TIMEOUT });
    await shot(page, "04-padrones-resultado-simulacion");
  });

  test("05-padrones-resultado-carga", async ({ page }) => {
    await mockCargarPadronesApi(page);
    await openReview(page, CARGAR_STAGE, COLUMN_CHECKS_CARGAR);
    await page.getByRole("button", { name: "Cargar ahora" }).click();
    await expect(page.getByText("Carga terminada: la tabla destino se actualizó.")).toBeVisible({ timeout: RESULT_TIMEOUT });
    await shot(page, "05-padrones-resultado-carga");
  });

  test("06-actualizar-tablas", async ({ page }) => {
    await mockActualizarPadronApi(page);
    await openTables(page, ACTUALIZAR_STAGE, COLUMN_CHECKS_ACTUALIZAR);
    await shot(page, "06-actualizar-tablas");
  });

  test("07-actualizar-opciones", async ({ page }) => {
    await mockActualizarPadronApi(page);
    await openOptions(page, ACTUALIZAR_STAGE, COLUMN_CHECKS_ACTUALIZAR);
    await expect(page.getByLabel("Ajustar secuencias de destino")).not.toBeChecked();
    await shot(page, "07-actualizar-opciones");
  });

  test("08-actualizar-revisar", async ({ page }) => {
    await mockActualizarPadronApi(page);
    await openReview(page, ACTUALIZAR_STAGE, COLUMN_CHECKS_ACTUALIZAR);
    await expect(page.getByRole("button", { name: "Analizar" })).toBeEnabled();
    await shot(page, "08-actualizar-revisar");
  });

  test("09-actualizar-analisis", async ({ page }) => {
    await mockActualizarPadronApi(page);
    await openReview(page, ACTUALIZAR_STAGE, COLUMN_CHECKS_ACTUALIZAR);
    await page.getByRole("button", { name: "Analizar" }).click();
    await expect(page.getByRole("heading", { name: "Persistir cambios revisados" })).toBeVisible({ timeout: RESULT_TIMEOUT });
    await page.getByText("Geometrías pendientes (4)", { exact: true }).click();
    await page.getByText("Pares por coincidencia parcial pendientes (2)", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Aceptar todos" }).first()).toBeVisible();
    await shot(page, "09-actualizar-analisis");
  });

  test("10-actualizar-persistir", async ({ page }) => {
    await mockActualizarPadronApi(page);
    await openReview(page, ACTUALIZAR_STAGE, COLUMN_CHECKS_ACTUALIZAR);
    await page.getByRole("button", { name: "Analizar" }).click();
    const heading = page.getByRole("heading", { name: "Persistir cambios revisados" });
    await expect(heading).toBeVisible({ timeout: RESULT_TIMEOUT });
    await expect(page.getByRole("button", { name: "Persistir cambios revisados" })).toBeEnabled();
    const panel = heading.locator("..");
    await takeShot(page, { tool: TOOL, name: "10-actualizar-persistir", target: panel });
  });

  test("11-actualizar-resultado", async ({ page }) => {
    await mockActualizarPadronApi(page);
    await openReview(page, ACTUALIZAR_STAGE, COLUMN_CHECKS_ACTUALIZAR);
    await page.getByRole("button", { name: "Analizar" }).click();
    const persist = page.getByRole("button", { name: "Persistir cambios revisados" });
    await expect(persist).toBeEnabled({ timeout: RESULT_TIMEOUT });
    await persist.click();
    await expect(page.getByText("Siguiente paso sugerido")).toBeVisible({ timeout: RESULT_TIMEOUT });
    await expect(page.getByText("Respaldo para revertir")).toBeVisible();
    await shot(page, "11-actualizar-resultado");
  });
});
