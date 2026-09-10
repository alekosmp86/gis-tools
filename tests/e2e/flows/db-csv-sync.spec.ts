import { test, expect } from "../support/testFixture";
import { SAMPLE_CSV_CONTENT } from "../fixtures/sampleFiles";
import {
  connectDb,
  assertStep1RemountQuirk,
  fillDbCredentials,
} from "../support/wizardSteps";

test.describe("Herramienta: Sincronización DB vs. Archivo CSV (/tools/db-csv-sync)", () => {
  test.beforeEach(async ({ mockBackend }) => {
    await mockBackend();
  });

  test("debe cargar la vista inicial con el paso 1 activo y el avance bloqueado", async ({ page }) => {
    await page.goto("/tools/db-csv-sync");

    // Verificar encabezado y pasos del wizard
    await expect(
      page.getByRole("heading", { name: "Sincronización de Datos DB vs. Archivo CSV" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "1. Conectar a Base de Datos PostgreSQL" })
    ).toBeVisible();

    // El botón "Continuar al Paso 2" debe estar deshabilitado inicialmente
    const nextButton = page.getByRole("button", { name: "Continuar al Paso 2" });
    await expect(nextButton).toBeVisible();
    await expect(nextButton).toBeDisabled();
  });

  test("debe bloquear la conexión y mostrar mensaje de validación con campos vacíos", async ({ page }) => {
    await page.goto("/tools/db-csv-sync");

    // Intentar conectar con campos vacíos
    await page.getByRole("button", { name: "Conectar y Obtener Columnas" }).click();

    // Verificar mensaje de alerta de validación
    await expect(
      page.getByText("Por favor ingrese el nombre de la base de datos, usuario y nombre de la tabla.")
    ).toBeVisible();

    // El avance al paso 2 sigue deshabilitado
    await expect(page.getByRole("button", { name: "Continuar al Paso 2" })).toBeDisabled();
  });

  test("debe permitir navegar el flujo completo (Pasos 1 al 5) y retroceder con sus guardas", async ({ page }) => {
    await page.goto("/tools/db-csv-sync");

    // --- PASO 1: Conexión a Base de Datos ---
    await connectDb(page);

    // Ahora el botón debe habilitarse y avanzar al paso 2
    const nextToStep2 = page.getByRole("button", { name: "Continuar al Paso 2" });
    await expect(nextToStep2).toBeEnabled();
    await nextToStep2.click();

    // --- PASO 2: Carga de CSV ---
    await expect(
      page.getByRole("heading", { name: "2. Cargar Archivo de Datos CSV" })
    ).toBeVisible();

    // Guarda: Sin archivo cargado, el avance al paso 3 está deshabilitado
    const nextToStep3 = page.getByRole("button", { name: "Continuar al Paso 3" });
    await expect(nextToStep3).toBeDisabled();

    // Probar retroceso al paso 1:
    await page.getByRole("button", { name: "Volver al Paso 1" }).click();
    await expect(
      page.getByRole("heading", { name: "1. Conectar a Base de Datos PostgreSQL" })
    ).toBeVisible();

    // Caracterización del comportamiento actual (D4 / G6 / H10):
    await assertStep1RemountQuirk(page);

    // Cargar archivo CSV
    await page.getByLabel("Seleccionar archivo CSV").setInputFiles({
      name: "parcelas.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(SAMPLE_CSV_CONTENT),
    });

    // Validar que el archivo fue cargado y se visualiza su resumen
    await expect(page.getByText("parcelas.csv")).toBeVisible();
    await expect(nextToStep3).toBeEnabled();
    await nextToStep3.click();

    // --- PASO 3: Mapeo SUID ---
    await expect(
      page.getByRole("heading", { name: "3. Configuración de SUID y Campos a Comparar" })
    ).toBeVisible();

    // H3: Navegación hacia atrás mediante el indicador de pasos (Stepper)
    // En el paso 3, los pasos 4 y 5 no deben tener role="button"
    await expect(page.getByRole("button", { name: /PASO 4/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /PASO 5/i })).toHaveCount(0);

    // Hacer clic en PASO 1 en el stepper y verificar retorno a la vista del paso 1
    const step1StepperBtn = page.getByRole("button", { name: /PASO 1/i });
    await expect(step1StepperBtn).toBeVisible();
    await step1StepperBtn.click();
    await expect(
      page.getByRole("heading", { name: "1. Conectar a Base de Datos PostgreSQL" })
    ).toBeVisible();

    // Reconectar y volver al paso 3 para continuar el flujo
    await connectDb(page);
    await page.getByRole("button", { name: "Continuar al Paso 2" }).click();
    await page.getByRole("button", { name: "Continuar al Paso 3" }).click();

    // Probar retroceso al paso 2
    await page.getByRole("button", { name: "Volver al Paso 2" }).click();
    await expect(
      page.getByRole("heading", { name: "2. Cargar Archivo de Datos CSV" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Continuar al Paso 3" }).click();

    // Seleccionar 'suid' y deseleccionar 'gid' para que coincida la clave con el CSV
    await page.getByRole("button", { name: "suid", exact: true }).click();
    await page.getByRole("button", { name: "gid", exact: true }).click();

    // Seleccionar atributos a comparar: departamento y codigo
    await page.getByRole("checkbox", { name: "departamento", exact: true }).click();
    await page.getByRole("checkbox", { name: "codigo", exact: true }).click();

    // Avanzar al paso 4
    const nextToStep4 = page.getByRole("button", {
      name: "Continuar a Parámetros de Sincronización",
    });
    await expect(nextToStep4).toBeEnabled();
    await nextToStep4.click();

    // --- PASO 4: Parámetros Avanzados ---
    await expect(
      page.getByRole("heading", { name: "4. Parámetros Avanzados de Sincronización" })
    ).toBeVisible();

    // Probar retroceso al paso 3
    await page.getByRole("button", { name: "Volver al Paso 3: Mapeo SUID" }).click();
    await expect(
      page.getByRole("heading", { name: "3. Configuración de SUID y Campos a Comparar" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Continuar a Parámetros de Sincronización" }).click();

    // Iniciar análisis y comparación hacia paso 5
    const nextToStep5 = page.getByRole("button", {
      name: "Iniciar Análisis y Comparación",
    });
    await expect(nextToStep5).toBeEnabled();
    await nextToStep5.click();

    // --- PASO 5: Resultados ---
    await expect(
      page.getByRole("heading", { name: "5. Resultados de Análisis y Discrepancias" })
    ).toBeVisible();
    // G1: Verificar que ComparisonResultsView montó su contenido real
    await expect(page.getByRole("button", { name: /Total Evaluados/i })).toBeVisible();

    // H4: Verificar título KPI derivado del descriptor específico y fila concreta de discrepancia
    await expect(page.getByRole("button", { name: /Solo en Archivo CSV/i })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PAD-002" })).toBeVisible();

    // H5: un CSV no tiene geometría, así que la pestaña de mapa nunca debe aparecer aquí — si lo
    // hiciera, el usuario vería un lienzo de Leaflet vacío en una comparación que no tiene mapa.
    await expect(
      page.getByRole("button", { name: /Mapa de Discrepancias Espaciales/i })
    ).toHaveCount(0);

    // Botón para retroceder al paso 4
    const backToStep4 = page.getByRole("button", {
      name: "Volver al Paso 4: Parámetros de Sincronización",
    });
    await expect(backToStep4).toBeVisible();
    await backToStep4.click();
    await expect(
      page.getByRole("heading", { name: "4. Parámetros Avanzados de Sincronización" })
    ).toBeVisible();
  });

  test("debe mostrar alerta de error cuando el servidor falla al obtener columnas (HTTP 500)", async ({
    page,
    mockBackend,
    allowConsoleErrors,
  }) => {
    allowConsoleErrors(/Failed to load resource/);
    await mockBackend({
      columnsStatus: 500,
    });

    await page.goto("/tools/db-csv-sync");
    await fillDbCredentials(page);
    await page.getByRole("button", { name: "Conectar y Obtener Columnas" }).click();

    // Debe mostrar la alerta de error con el mensaje de fallo y mantener el avance bloqueado
    await expect(page.getByText("Error al inspeccionar tabla")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continuar al Paso 2" })).toBeDisabled();
  });
});
