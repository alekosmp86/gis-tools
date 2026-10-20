import type { Page } from "@playwright/test";
import { test, expect } from "../support/testFixture";
import {
  DEFAULT_DB2_COLUMNS_RESPONSE,
  DEFAULT_STREAM_META,
  buildNdjsonStream,
} from "../fixtures/dbFixtures";
import { connectDb, assertStep1RemountQuirk } from "../support/wizardSteps";
import { CONNECTED_MOCKS, SOURCE_DB, TARGET_DB } from "../wiki-screenshots/db-db-sync.mocks";
import { connectDatabase } from "../wiki-screenshots/wizardShotHelpers";

test.describe("Herramienta: Sincronización DB vs. DB (/tools/db-db-sync)", () => {
  test.beforeEach(async ({ mockBackend }) => {
    await mockBackend({
      columns: (body) => {
        if (body.table_name === "parcelas_replica") {
          return DEFAULT_DB2_COLUMNS_RESPONSE;
        }
        return {
          ...DEFAULT_DB2_COLUMNS_RESPONSE,
          tableName: "parcelas_origen",
        };
      },
      recordsStream: (body) => {
        if (body.table_name === "parcelas_replica") {
          return buildNdjsonStream(DEFAULT_STREAM_META, {
            type: "CHUNK",
            current: 2,
            total: 2,
            rows: [
              {
                gid: 1,
                suid: "PAD-001",
                departamento: "MONTEVIDEO",
                codigo: "A1",
                geom: null,
              },
              {
                gid: 2,
                suid: "PAD-002",
                departamento: "CANELONES",
                codigo: "B2_REPLICA_DIFF",
                geom: null,
              },
            ],
          });
        }
        return buildNdjsonStream();
      },
    });
  });

  test("debe cargar la vista inicial con el paso 1 activo y el avance bloqueado", async ({ page }) => {
    await page.goto("/tools/db-db-sync");

    await expect(
      page.getByRole("heading", { name: "Sincronización de Datos DB vs. DB (Réplicas)" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "1. Configurar Base de Datos Origen (DB 1)" })
    ).toBeVisible();

    const nextButton = page.getByRole("button", { name: "Continuar al Paso 2" });
    await expect(nextButton).toBeVisible();
    await expect(nextButton).toBeDisabled();
  });

  test("debe validar credenciales requeridas en el paso 1", async ({ page }) => {
    await page.goto("/tools/db-db-sync");

    await page.getByRole("button", { name: "Conectar y Obtener Columnas" }).click();

    await expect(
      page.getByText("Por favor ingrese el nombre de la base de datos, usuario y nombre de la tabla.")
    ).toBeVisible();

    await expect(page.getByRole("button", { name: "Continuar al Paso 2" })).toBeDisabled();
  });

  test("debe permitir navegar el flujo completo en modo Comparar (Pasos 1 al 6) y retroceder", async ({ page }) => {
    await page.goto("/tools/db-db-sync");

    // --- PASO 1: Conexión DB 1 (Origen) ---
    await connectDb(page, {
      database: "sig_origen",
      user: "postgres",
      table: "parcelas_origen",
    });

    const nextToStep2 = page.getByRole("button", { name: "Continuar al Paso 2" });
    await expect(nextToStep2).toBeEnabled();
    await nextToStep2.click();

    // --- PASO 2: Conexión DB 2 (Destino) ---
    await expect(
      page.getByRole("heading", { name: "2. Configurar Base de Datos Destino (DB 2)" })
    ).toBeVisible();

    // Guarda: Sin conectar DB 2, el botón al paso 3 está deshabilitado
    const nextToStep3 = page.getByRole("button", { name: "Continuar al Paso 3" });
    await expect(nextToStep3).toBeDisabled();

    // Probar retroceso al paso 1
    await page.getByRole("button", { name: "Volver al Paso 1" }).click();
    await expect(
      page.getByRole("heading", { name: "1. Configurar Base de Datos Origen (DB 1)" })
    ).toBeVisible();

    // Caracterización del comportamiento actual (D4 / G6 / H10):
    await assertStep1RemountQuirk(
      page,
      {
        database: "sig_origen",
        user: "postgres",
        table: "parcelas_origen",
      },
      "1. Configurar Base de Datos Origen (DB 1)"
    );

    // Conectar DB 2
    await connectDb(page, {
      database: "sig_replica",
      user: "postgres",
      table: "parcelas_replica",
    });

    await expect(nextToStep3).toBeEnabled();
    await nextToStep3.click();

    // --- PASO 3: Modo de Sincronización ---
    await expect(page.getByRole("heading", { name: "3. Modo de Sincronización" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Comparar/ })).toBeChecked();

    // Probar retroceso al paso 2
    await page.getByRole("button", { name: "Volver al Paso 2: DB Destino" }).click();
    await expect(
      page.getByRole("heading", { name: "2. Configurar Base de Datos Destino (DB 2)" })
    ).toBeVisible();

    // Reconectar DB 2 para habilitar proceed()
    await connectDb(page, {
      database: "sig_replica",
      user: "postgres",
      table: "parcelas_replica",
    });
    await page.getByRole("button", { name: "Continuar al Paso 3" }).click();
    await expect(page.getByRole("heading", { name: "3. Modo de Sincronización" })).toBeVisible();

    // --- PASO 4: Mapeo SUID ---
    await page.getByRole("button", { name: "Continuar a Mapeo SUID" }).click();
    await expect(
      page.getByRole("heading", { name: "4. Configuración de SUID y Campos a Comparar" })
    ).toBeVisible();

    // Retroceso al paso 3
    await page.getByRole("button", { name: "Volver al Paso 3: Modo" }).click();
    await expect(page.getByRole("heading", { name: "3. Modo de Sincronización" })).toBeVisible();
    await page.getByRole("button", { name: "Continuar a Mapeo SUID" }).click();

    // Avanzar al paso 5
    const nextToParameters = page.getByRole("button", {
      name: "Continuar a Parámetros de Sincronización",
    });
    await expect(nextToParameters).toBeEnabled();
    await nextToParameters.click();

    // --- PASO 5: Parámetros ---
    await expect(
      page.getByRole("heading", { name: "5. Parámetros Avanzados de Sincronización" })
    ).toBeVisible();

    // Retroceso al paso 4
    await page.getByRole("button", { name: "Volver al Paso 4: Mapeo SUID" }).click();
    await expect(
      page.getByRole("heading", { name: "4. Configuración de SUID y Campos a Comparar" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Continuar a Parámetros de Sincronización" }).click();

    // Avanzar al paso 6
    const analyze = page.getByRole("button", { name: "Iniciar Análisis y Comparación" });
    await expect(analyze).toBeEnabled();
    await analyze.click();

    // --- PASO 6: Resultados ---
    await expect(
      page.getByRole("heading", { name: "6. Resultados de Análisis y Discrepancias" })
    ).toBeVisible();
    // G1: Verificar que ComparisonResultsView montó su contenido real
    await expect(page.getByRole("button", { name: /Total Evaluados/i })).toBeVisible();

    // H4: Verificar título KPI derivado del descriptor DB vs DB y fila concreta de discrepancia
    await expect(page.getByRole("button", { name: /Solo en DB Origen/i })).toBeVisible();
    await expect(page.getByRole("cell", { name: "3", exact: true })).toBeVisible();

    // H5: una comparación DB vs DB no trae geometría en este fixture, así que la pestaña de mapa
    // nunca debe aparecer — si lo hiciera, el usuario vería un lienzo de Leaflet vacío.
    await expect(
      page.getByRole("button", { name: /Mapa de Discrepancias Espaciales/i })
    ).toHaveCount(0);

    // Retroceso al paso 5
    const backToParameters = page.getByRole("button", {
      name: "Volver al Paso 5: Parámetros de Sincronización",
    });
    await expect(backToParameters).toBeVisible();
    await backToParameters.click();
    await expect(
      page.getByRole("heading", { name: "5. Parámetros Avanzados de Sincronización" })
    ).toBeVisible();
  });
});

test.describe("Herramienta: Sincronización DB vs. DB - modo de sincronización y reemplazo completo", () => {
  let executeRequests: string[];

  test.beforeEach(async ({ page, mockBackend }) => {
    executeRequests = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/db/execute")) executeRequests.push(request.url());
    });
    await mockBackend(CONNECTED_MOCKS);
  });

  test.afterEach(() => {
    expect(executeRequests).toEqual([]);
  });

  async function goToModeStep(page: Page): Promise<void> {
    await page.goto("/tools/db-db-sync");
    await connectDatabase(page, SOURCE_DB);
    await page.getByRole("button", { name: "Continuar al Paso 2" }).click();
    await expect(
      page.getByRole("heading", { name: "2. Configurar Base de Datos Destino (DB 2)" })
    ).toBeVisible();
    await connectDatabase(page, TARGET_DB);
    await page.getByRole("button", { name: "Continuar al Paso 3" }).click();
    await expect(page.getByRole("heading", { name: "3. Modo de Sincronización" })).toBeVisible();
  }

  test("debe mostrar ambos modos con su descripción y Comparar preseleccionado", async ({ page }) => {
    await goToModeStep(page);

    await expect(page.getByRole("radio", { name: /^Comparar/ })).toBeChecked();
    await expect(page.getByRole("radio", { name: /^Reemplazo completo/ })).not.toBeChecked();
    await expect(page.getByText(/Correlaciona ambas tablas por SUID/)).toBeVisible();
    await expect(page.getByText(/Vacía la tabla destino y la recarga/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Continuar a Mapeo SUID" })).toBeEnabled();
  });

  test("debe cambiar los pasos al elegir Reemplazo completo y restaurarlos al volver a Comparar", async ({ page }) => {
    await goToModeStep(page);
    const main = page.locator("main");

    // AC-1: modo Comparar -> 6 pasos
    await expect(main.getByText("Mapeo SUID", { exact: true })).toBeVisible();
    await expect(main.getByText("Parámetros", { exact: true })).toBeVisible();
    await expect(main.getByText("Resultados", { exact: true })).toBeVisible();
    await expect(main.getByText("PASO 6", { exact: true })).toBeVisible();

    // AC-2: modo Reemplazo -> 5 pasos
    await page.getByText("Reemplazo completo", { exact: true }).click();
    await expect(page.getByRole("radio", { name: /^Reemplazo completo/ })).toBeChecked();
    await expect(main.getByText("Mapeo de Columnas", { exact: true })).toBeVisible();
    await expect(main.getByText("Reemplazo Completo", { exact: true })).toBeVisible();
    await expect(main.getByText("PASO 5", { exact: true })).toBeVisible();
    await expect(main.getByText("PASO 6", { exact: true })).toHaveCount(0);
    await expect(main.getByText("Mapeo SUID", { exact: true })).toHaveCount(0);
    await expect(main.getByText("Resultados", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continuar a Mapeo de Columnas" })).toBeVisible();

    // Volver a Comparar restaura el flujo de comparación
    await page.getByText("Comparar", { exact: true }).click();
    await expect(page.getByRole("radio", { name: /^Comparar/ })).toBeChecked();
    await expect(main.getByText("Mapeo SUID", { exact: true })).toBeVisible();
    await expect(main.getByText("Parámetros", { exact: true })).toBeVisible();
    await expect(main.getByText("Resultados", { exact: true })).toBeVisible();
    await expect(main.getByText("PASO 6", { exact: true })).toBeVisible();
    await expect(main.getByText("Mapeo de Columnas", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continuar a Mapeo SUID" })).toBeVisible();
  });

  test("debe llegar a la confirmación del reemplazo y mantener bloqueado el botón hasta confirmar tabla y contraseña", async ({ page }) => {
    await goToModeStep(page);
    await page.getByText("Reemplazo completo", { exact: true }).click();
    await page.getByRole("button", { name: "Continuar a Mapeo de Columnas" }).click();

    // --- PASO 4: Mapeo de columnas ---
    await expect(
      page.getByRole("heading", { name: "4. Mapeo de Columnas Origen a Destino" })
    ).toBeVisible();
    await expect(page.getByLabel("Columna origen para padron")).toHaveValue("padron");
    await expect(page.getByLabel("Columna origen para departamento")).toHaveValue("departamento");
    await expect(page.getByLabel("Columna origen para gid")).toHaveValue("gid");
    await expect(page.getByLabel("Columna origen para id_carga")).toHaveValue("");
    await expect(page.getByText("NOT NULL (requerido)").first()).toBeVisible();

    // --- PASO 5: Reemplazo completo ---
    await page.getByRole("button", { name: "Continuar a Reemplazo Completo" }).click();
    await expect(
      page.getByRole("heading", { name: "5. Reemplazo Completo de la Tabla Destino" })
    ).toBeVisible();
    await expect(page.getByText(/Acción destructiva: se eliminarán TODOS los registros/)).toBeVisible();
    await expect(page.getByText(TARGET_DB.host).first()).toBeVisible();
    await expect(page.getByText(SOURCE_DB.host).first()).toBeVisible();

    const run = page.getByRole("button", { name: "Vaciar destino y recargar desde origen" });
    const confirm = page.getByLabel(/Para confirmar, escriba/);
    const password = page.getByLabel(/Contraseña de PostgreSQL del destino/);
    await expect(run).toBeDisabled();

    // Solo la contraseña: sigue bloqueado
    await password.fill(TARGET_DB.password);
    await expect(run).toBeDisabled();

    // Tabla incorrecta + contraseña: sigue bloqueado
    await confirm.fill("public.otra_tabla");
    await expect(run).toBeDisabled();

    // Tabla exacta sin contraseña: sigue bloqueado
    await password.fill("");
    await confirm.fill("public.parcelas");
    await expect(run).toBeDisabled();

    // Ambos: habilitado (NUNCA se hace clic)
    await password.fill(TARGET_DB.password);
    await expect(run).toBeEnabled();

    // Retroceso con las etiquetas del modo Reemplazo
    await page.getByRole("button", { name: "Volver al Paso 4: Mapeo de Columnas" }).click();
    await expect(
      page.getByRole("heading", { name: "4. Mapeo de Columnas Origen a Destino" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Volver al Paso 3: Modo" }).click();
    await expect(page.getByRole("heading", { name: "3. Modo de Sincronización" })).toBeVisible();
  });
});
