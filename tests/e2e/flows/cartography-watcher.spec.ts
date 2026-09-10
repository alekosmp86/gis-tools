import { test, expect } from "../support/testFixture";
import { connectDb } from "../support/wizardSteps";

test.describe("Módulo: Observador Cartográfico (/tools/m/cartography-watcher)", () => {
  test.beforeEach(async ({ mockBackend }) => {
    await mockBackend();
  });

  test("debe listar fuentes vigiladas y sus estados en el dashboard", async ({ page }) => {
    await page.goto("/tools/m/cartography-watcher");

    // Verificar encabezado de la página
    await expect(
      page.getByRole("heading", { name: "Observador de Actualizaciones Cartográficas" })
    ).toBeVisible();

    // Deben listarse las fuentes configuradas en los fixtures
    await expect(page.getByText("Catastro Nacional de Parcelas")).toBeVisible();
    await expect(page.getByText("Red Vial Nacional")).toBeVisible();

    // H6: Verificar valores reales y ambos estados de SourceStatusBadge sin selectores ambiguos .first()
    await expect(page.getByText("Al día")).toBeVisible();
    await expect(page.getByText("Actualización disponible")).toBeVisible();
    await expect(page.getByText("Sin novedades")).toBeVisible();
    await expect(
      page.getByRole("definition").filter({ hasText: "1 archivo pendiente" })
    ).toBeVisible();
    await expect(page.getByText("4", { exact: true })).toBeVisible();
  });

  test("debe agregar una nueva fuente vigilada desde el formulario", async ({ page }) => {
    await page.goto("/tools/m/cartography-watcher");

    // Llenar formulario de agregar fuente
    const input = page.getByPlaceholder("https://catalogodatos.gub.uy/dataset/...");
    await input.fill("https://catalogodatos.gub.uy/dataset/nueva-fuente-sig");

    await page.getByRole("button", { name: "Vigilar fuente" }).click();

    // H6: Debe aparecer la tarjeta con el título fijo mockeado
    await expect(page.getByText("Nueva Fuente SIG E2E")).toBeVisible();
  });

  test("debe mantener el formulario abierto, conservar la URL ingresada y mostrar el error si el servidor rechaza la edición", async ({
    page,
    mockBackend,
    allowConsoleErrors,
  }) => {
    // H8: Tolerar únicamente el error de red esperado (HTTP 400)
    allowConsoleErrors(/Failed to load resource/);

    // Configurar respuesta de rechazo del servidor en /sources/update
    await mockBackend({
      watcherUpdate: () => ({
        status: 400,
        body: {
          success: false,
          error: "El catálogo indicado no contiene recursos espaciales válidos.",
        },
      }),
    });

    await page.goto("/tools/m/cartography-watcher");

    // Localizar la tarjeta editable (Red Vial Nacional)
    const card = page.getByRole("article").filter({ hasText: "Red Vial Nacional" });
    await expect(card).toBeVisible();

    // Iniciar edición
    await card.getByRole("button", { name: "Editar" }).click();

    // El formulario de edición debe abrirse dentro de la tarjeta
    const editInput = card.getByLabel("URL o identificador del catálogo");
    await expect(editInput).toBeVisible();

    // Escribir nueva URL que será rechazada por el servidor
    const rejectedUrl = "https://catalogodatos.gub.uy/dataset/red-vial-rechazada";
    await editInput.fill(rejectedUrl);

    // Guardar cambio
    await card.getByRole("button", { name: "Guardar" }).click();

    // CONTRATO CRÍTICO:
    // 1. El formulario debe permanecer abierto (el input sigue visible).
    await expect(editInput).toBeVisible();

    // 2. Debe conservar intacta la URL ingresada por el usuario.
    await expect(editInput).toHaveValue(rejectedUrl);

    // 3. Debe mostrar el mensaje en español retornado por el cliente dentro de la tarjeta.
    // (Nota D4: watcherClient.ts readJson lanza `${context} (HTTP ${status})` en HTTP !ok antes de parsear JSON)
    await expect(
      card.getByText("No se pudo actualizar la fuente (HTTP 400).")
    ).toBeVisible();
  });

  test("debe expandir el árbol del catálogo y filtrar por formato al seleccionar recursos en sync tools", async ({
    page,
  }) => {
    await page.goto("/tools/db-csv-sync");

    // H10: Paso 1: Conexión mediante helper reutilizable connectDb
    await connectDb(page);
    await page.getByRole("button", { name: "Continuar al Paso 2" }).click();

    // Paso 2: Abrir pestaña de Catálogo Cartográfico del módulo
    const catalogTab = page.getByRole("tab", { name: "Catálogo Cartográfico" });
    await expect(catalogTab).toBeVisible();
    await catalogTab.click();

    // Verificar texto introductorio del selector de catálogo
    await expect(
      page.getByText(
        "Seleccione un archivo publicado en los catálogos vigilados. Se descarga una sola vez y queda en caché para las comparaciones siguientes."
      )
    ).toBeVisible();

    // El grupo debe estar inicialmente colapsado
    const groupHeader = page.getByRole("button", { name: /Catastro Nacional de Parcelas/i });
    await expect(groupHeader).toBeVisible();

    // Al expandir el grupo, debe mostrar los recursos filtrados para CSV
    await groupHeader.click();

    const resourceBtn = page.getByRole("button", { name: /parcelas_montevideo\.csv/i });
    await expect(resourceBtn).toBeVisible();

    // Verificar que recursos de formato no compatible (ZIP) fueron excluidos por el filtro
    await expect(page.getByRole("button", { name: /parcelas_montevideo\.zip/i })).toHaveCount(0);

    // Seleccionar el archivo del catálogo
    await resourceBtn.click();

    // El archivo seleccionado debe procesarse e incorporarse en el paso 2
    await expect(page.getByText("parcelas_montevideo.csv")).toBeVisible();

    // El botón continuar al paso 3 debe habilitarse
    await expect(page.getByRole("button", { name: "Continuar al Paso 3" })).toBeEnabled();
  });
});
