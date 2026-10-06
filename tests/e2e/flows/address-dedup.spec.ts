import { test, expect } from "../support/testFixture";
import type { Page } from "@playwright/test";
import {
  DEDUP_ANALYZE_RESPONSE,
  DEDUP_CSV_BODY,
  DEDUP_GROUP_COUNT,
} from "../fixtures/dedupFixtures";
import {
  DEDUP_PROVINCES_RESPONSE,
  loadAndSelectProvince,
  mockProvinces,
} from "../support/dedupProvince";

const PAGE_URL = "/tools/m/address-dedup";
const ANALYZE_URL = "**/api/m/address-dedup/analyze";
const EXPORT_URL = "**/api/m/address-dedup/export";

async function mockDedupApi(page: Page): Promise<void> {
  await mockProvinces(page);
  await page.route(ANALYZE_URL, (route) => route.fulfill({ json: DEDUP_ANALYZE_RESPONSE }));
  await page.route(EXPORT_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="address-dedup-provincia-7.csv"',
      },
      body: DEDUP_CSV_BODY,
    })
  );
}

async function fillConnection(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Analizar duplicados" })).toBeEnabled();
  const fields = [
    ["Base de datos", "carto"],
    ["Usuario", "reader"],
    ["Contraseña", "secreto"],
  ] as const;
  for (const [label, value] of fields) {
    const input = page.getByLabel(label);
    await input.fill(value);
    await expect(input).toHaveValue(value);
  }
  await loadAndSelectProvince(page);
}

async function runAnalysis(page: Page): Promise<void> {
  await fillConnection(page);
  await page.getByRole("button", { name: "Analizar duplicados" }).click();
  await expect(page.getByRole("tab", { name: "Resumen" })).toHaveAttribute("aria-selected", "true");
}

async function openGroupsTab(page: Page): Promise<void> {
  await page.getByRole("tab", { name: `Grupos (${DEDUP_GROUP_COUNT})` }).click();
  await expect(page.getByText(`Mostrando ${DEDUP_GROUP_COUNT} de ${DEDUP_GROUP_COUNT} grupos`)).toBeVisible();
}

test.describe("Módulo: Duplicados de Direcciones (/tools/m/address-dedup)", () => {
  test.beforeEach(async ({ page }) => {
    await mockDedupApi(page);
    await page.goto(PAGE_URL);
  });

  test("debe mostrar solo la tarjeta de configuración antes de ejecutar", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Configuración" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Analizar duplicados" })).toBeVisible();
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Editar parámetros" })).toHaveCount(0);
  });

  test("debe mostrar la barra de contexto y el resumen con KPIs y ambas tablas tras ejecutar", async ({
    page,
  }) => {
    await runAnalysis(page);

    await expect(page.getByText("carto@localhost")).toBeVisible();
    await expect(page.getByText("FLORES", { exact: true })).toBeVisible();
    await expect(page.getByText("secreto")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Configuración" })).toHaveCount(0);

    await expect(page.getByText("A eliminar", { exact: true })).toBeVisible();
    await expect(page.getByText("A conservar", { exact: true })).toBeVisible();
    await expect(page.getByText("Para revisar", { exact: true })).toBeVisible();
    await expect(page.getByRole("table", { name: "Filas por decisión y fuente" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Filas por motivo de decisión" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Otras / sin fuente" })).toBeVisible();
  });

  test("debe cambiar a la pestaña Grupos y mostrar la tabla completa de grupos", async ({ page }) => {
    await runAnalysis(page);
    await openGroupsTab(page);

    await expect(page.getByRole("table", { name: "Grupos de direcciones duplicadas" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Grupo 1/ })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("cgeo:Antel:address:id:101")).toBeVisible();
  });

  test("debe mostrar una columna por cada campo de la clave de agrupación", async ({ page }) => {
    await runAnalysis(page);
    await openGroupsTab(page);

    const groupTable = page.getByRole("table", { name: "Grupos de direcciones duplicadas" });
    const headers = [
      "Provincia",
      "Cód. provincia",
      "Cód. localidad",
      "Localidad",
      "Cód. postal",
      "Localidad padrón / geo",
      "Calle",
      "Número",
      "Letra",
      "Manzana",
      "Solar",
      "Km",
      "Padrón",
      "Tipo de padrón",
      "Ref. tramo",
    ];
    for (const header of headers) {
      await expect(groupTable.getByRole("columnheader", { name: header, exact: true })).toBeVisible();
    }
    await expect(groupTable.getByRole("cell", { name: "UY-SJ" }).first()).toBeVisible();
  });

  test("debe mostrar barras de desplazamiento superior e inferior sincronizadas en pantallas estrechas", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await runAnalysis(page);
    await openGroupsTab(page);

    const topScroller = page.getByTestId("dedup-scroll-top");
    const contentScroller = page.getByTestId("dedup-scroll-content");
    await expect(topScroller).toBeVisible();
    await expect(contentScroller).toBeVisible();

    await topScroller.evaluate((element) => {
      element.scrollLeft = 200;
    });
    await expect
      .poll(() => contentScroller.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(150);

    await contentScroller.evaluate((element) => {
      element.scrollLeft = 50;
    });
    await expect
      .poll(() => topScroller.evaluate((element) => element.scrollLeft))
      .toBeLessThan(100);
  });

  test("no debe desplazar la página horizontalmente a 360px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await runAnalysis(page);
    await openGroupsTab(page);

    const hasPageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );

    expect(hasPageOverflow).toBe(false);
  });

  test("debe mostrar la barra superior solo cuando la tabla desborda", async ({ page }) => {
    await page.setViewportSize({ width: 3840, height: 1000 });
    await runAnalysis(page);
    await openGroupsTab(page);

    const contentScroller = page.getByTestId("dedup-scroll-content");
    const topScroller = page.getByTestId("dedup-scroll-top");
    const overflows = await contentScroller.evaluate((element) => element.scrollWidth > element.clientWidth);

    if (overflows) {
      await expect(topScroller).toBeVisible();
    } else {
      await expect(topScroller).toBeHidden();
    }
  });

  test("debe permitir navegar las pestañas con el teclado", async ({ page }) => {
    await runAnalysis(page);

    await page.getByRole("tab", { name: "Resumen" }).focus();
    await page.keyboard.press("ArrowRight");

    await expect(page.getByRole("tab", { name: /Grupos/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: /Grupos/ })).toBeFocused();
  });

  test("debe acotar los grupos con la búsqueda", async ({ page }) => {
    await runAnalysis(page);
    await openGroupsTab(page);

    await page.getByPlaceholder("Buscar por URN, padrón o calle").fill("  zorrilla ");

    await expect(page.getByText(`Mostrando 1 de ${DEDUP_GROUP_COUNT} grupos`)).toBeVisible();
    await expect(page.getByRole("button", { name: /Grupo 3/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Grupo 1\b/ })).toHaveCount(0);
  });

  test("debe acotar con el filtro de decisión, conservar todos los miembros y poder limpiar", async ({
    page,
  }) => {
    await runAnalysis(page);
    await openGroupsTab(page);

    await page.getByLabel("Decisión").selectOption({ label: "Eliminar" });

    await expect(page.getByText(`Mostrando 4 de ${DEDUP_GROUP_COUNT} grupos`)).toBeVisible();
    await expect(page.getByText("cgeo:ideuy:address:id:201")).toHaveCount(0);
    await expect(page.getByText("cgeo:Antel:address:id:101")).toBeVisible();

    await page.getByRole("button", { name: "Limpiar filtros" }).click();

    await expect(page.getByText(`Mostrando ${DEDUP_GROUP_COUNT} de ${DEDUP_GROUP_COUNT} grupos`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Limpiar filtros" })).toHaveCount(0);
  });

  test("debe conservar los filtros al cambiar de pestaña y reiniciarlos con un nuevo análisis", async ({
    page,
  }) => {
    await runAnalysis(page);
    await openGroupsTab(page);
    await page.getByLabel("Decisión").selectOption({ label: "Eliminar" });
    await expect(page.getByText(`Mostrando 4 de ${DEDUP_GROUP_COUNT} grupos`)).toBeVisible();

    await page.getByRole("tab", { name: "Resumen" }).click();
    await page.getByRole("tab", { name: /Grupos/ }).click();

    await expect(page.getByLabel("Decisión")).toHaveValue("REMOVE");
    await expect(page.getByText(`Mostrando 4 de ${DEDUP_GROUP_COUNT} grupos`)).toBeVisible();

    await page.getByRole("button", { name: "Volver a ejecutar" }).click();
    await expect(page.getByRole("tab", { name: "Resumen" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: /Grupos/ }).click();

    await expect(page.getByLabel("Decisión")).toHaveValue("ALL");
    await expect(page.getByText(`Mostrando ${DEDUP_GROUP_COUNT} de ${DEDUP_GROUP_COUNT} grupos`)).toBeVisible();
  });

  test("debe acotar al grupo ámbar con Solo para revisar", async ({ page }) => {
    await runAnalysis(page);
    await openGroupsTab(page);

    await page.getByLabel("Solo para revisar").check();

    await expect(page.getByText(`Mostrando 2 de ${DEDUP_GROUP_COUNT} grupos`)).toBeVisible();
    await expect(page.getByRole("button", { name: /Grupo 2/ })).toContainText("Revisar");
    await expect(page.getByRole("button", { name: /Grupo 7/ })).toContainText("Revisar");
  });

  test("debe abrir Grupos filtrado por eliminar al pulsar la tarjeta A eliminar", async ({ page }) => {
    await runAnalysis(page);

    await page.getByRole("button", { name: /A eliminar/ }).click();

    await expect(page.getByRole("tab", { name: /Grupos/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("Decisión")).toHaveValue("REMOVE");
    await expect(page.getByLabel("Solo para revisar")).not.toBeChecked();
    await expect(page.getByText(`Mostrando 4 de ${DEDUP_GROUP_COUNT} grupos`)).toBeVisible();
  });

  test("debe abrir Grupos solo para revisar al pulsar la tarjeta Para revisar", async ({ page }) => {
    await runAnalysis(page);

    await page.getByRole("button", { name: /Para revisar/ }).click();

    await expect(page.getByRole("tab", { name: /Grupos/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("Solo para revisar")).toBeChecked();
    await expect(page.getByLabel("Decisión")).toHaveValue("ALL");
    await expect(page.getByText(`Mostrando 2 de ${DEDUP_GROUP_COUNT} grupos`)).toBeVisible();
  });

  test("debe reemplazar el filtro previo en lugar de combinarlo al pulsar otra tarjeta", async ({
    page,
  }) => {
    await runAnalysis(page);
    await page.getByRole("button", { name: /Para revisar/ }).click();
    await expect(page.getByLabel("Solo para revisar")).toBeChecked();

    await page.getByRole("tab", { name: "Resumen" }).click();
    await page.getByRole("button", { name: /A eliminar/ }).click();

    await expect(page.getByLabel("Decisión")).toHaveValue("REMOVE");
    await expect(page.getByLabel("Solo para revisar")).not.toBeChecked();
    await expect(page.getByText(`Mostrando 4 de ${DEDUP_GROUP_COUNT} grupos`)).toBeVisible();
  });

  test("debe abrir Grupos sin filtros al pulsar la tarjeta Grupos", async ({ page }) => {
    await runAnalysis(page);
    await page.getByRole("button", { name: /Para revisar/ }).click();
    await page.getByRole("tab", { name: "Resumen" }).click();

    await page.getByRole("button", { name: /^Grupos/ }).click();

    await expect(page.getByLabel("Solo para revisar")).not.toBeChecked();
    await expect(page.getByText(`Mostrando ${DEDUP_GROUP_COUNT} de ${DEDUP_GROUP_COUNT} grupos`)).toBeVisible();
  });

  test("debe acotar con el filtro de motivo Tiene unidades internas", async ({ page }) => {
    await runAnalysis(page);
    await openGroupsTab(page);

    await page.getByLabel("Motivo").selectOption({ label: "Tiene unidades internas (revisar)" });

    await expect(page.getByText(`Mostrando 1 de ${DEDUP_GROUP_COUNT} grupos`)).toBeVisible();
    await expect(page.getByRole("button", { name: /Grupo 7/ })).toContainText("Revisar");
  });

  test("debe mostrar el estado vacío cuando los filtros no coinciden", async ({ page }) => {
    await runAnalysis(page);
    await openGroupsTab(page);

    await page.getByPlaceholder("Buscar por URN, padrón o calle").fill("no-existe-esta-calle");

    await expect(page.getByText("Ningún grupo coincide con los filtros aplicados.")).toBeVisible();
    await page.getByRole("button", { name: "Limpiar filtros" }).first().click();
    await expect(page.getByRole("table", { name: "Grupos de direcciones duplicadas" })).toBeVisible();
  });

  test("debe expandir y contraer todos los grupos", async ({ page }) => {
    await runAnalysis(page);
    await openGroupsTab(page);

    const groupTable = page.getByRole("table", { name: "Grupos de direcciones duplicadas" });

    await page.getByRole("button", { name: "Contraer todo" }).click();

    await expect(groupTable.locator('button[aria-expanded="false"]')).toHaveCount(DEDUP_GROUP_COUNT);
    await expect(page.getByText("cgeo:Antel:address:id:101")).toHaveCount(0);

    await page.getByRole("button", { name: "Expandir todo" }).click();

    await expect(groupTable.locator('button[aria-expanded="true"]')).toHaveCount(DEDUP_GROUP_COUNT);
    await expect(page.getByText("cgeo:Antel:address:id:101")).toBeVisible();
  });

  test("debe solicitar la exportación con el formato elegido", async ({ page }) => {
    await runAnalysis(page);

    const [exportRequest] = await Promise.all([
      page.waitForRequest((request) => request.url().endsWith("/api/m/address-dedup/export")),
      page.getByRole("button", { name: "Descargar todas las filas en CSV" }).click(),
    ]);

    expect(exportRequest.method()).toBe("POST");
    expect(exportRequest.postDataJSON()).toMatchObject({ format: "csv", provinceId: 7 });
  });

  test("debe reabrir el formulario con Editar parámetros y permitir cancelar", async ({ page }) => {
    await runAnalysis(page);

    await page.getByRole("button", { name: "Editar parámetros" }).click();

    await expect(page.getByRole("heading", { name: "Configuración" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Resumen" })).toBeVisible();

    await page.getByRole("button", { name: "Cancelar edición" }).click();

    await expect(page.getByRole("heading", { name: "Configuración" })).toHaveCount(0);
  });

  test("debe mostrar el error de validación en la tarjeta de configuración", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Analizar duplicados" })).toBeEnabled();
    await page.getByRole("button", { name: "Analizar duplicados" }).click();

    await expect(page.getByText("Seleccione un departamento.")).toBeVisible();
    await expect(page.getByRole("tablist")).toHaveCount(0);
  });

  test("debe habilitar el selector de departamento solo tras cargar la lista", async ({ page }) => {
    await expect(page.getByLabel("Departamento")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Cargar departamentos" })).toBeDisabled();

    await fillConnection(page);

    await expect(page.getByLabel("Departamento")).toHaveValue("7");
    await expect(page.getByLabel("Departamento").locator("option")).toHaveCount(
      DEDUP_PROVINCES_RESPONSE.provinces.length + 1
    );
  });

  test("debe resaltar el botón de carga solo cuando la conexión está lista y la lista vacía", async ({ page }) => {
    const loadButton = page.getByRole("button", { name: "Cargar departamentos" });
    await expect(loadButton).toHaveAttribute("data-attention", "false");

    for (const [label, value] of [["Base de datos", "carto"], ["Usuario", "reader"], ["Contraseña", "secreto"]] as const) {
      await page.getByLabel(label).fill(value);
    }
    await expect(loadButton).toHaveAttribute("data-attention", "true");

    await loadAndSelectProvince(page);
    await expect(loadButton).toHaveAttribute("data-attention", "false");
  });

  test("debe vaciar la lista y la selección al cambiar la conexión", async ({ page }) => {
    await fillConnection(page);

    await page.getByLabel("Base de datos").fill("otra");

    await expect(page.getByLabel("Departamento")).toBeDisabled();
    await expect(page.getByLabel("Departamento")).toHaveValue("");
  });

  test("debe limpiar la selección cuando falla una recarga de departamentos", async ({ page }) => {
    await fillConnection(page);
    await expect(page.getByLabel("Departamento")).toHaveValue("7");
    await page.route("**/api/m/address-dedup/provinces", (route) =>
      route.fulfill({ status: 500, json: { success: false, error: "No se pudieron cargar los departamentos." } })
    );

    await page.getByRole("button", { name: "Cargar departamentos" }).click();

    await expect(page.getByText("No se pudieron cargar los departamentos.")).toBeVisible();
    await expect(page.getByLabel("Departamento")).toHaveValue("");
  });

  test("debe mostrar el error de carga de departamentos sin romper el formulario", async ({ page }) => {
    await page.route("**/api/m/address-dedup/provinces", (route) =>
      route.fulfill({ status: 500, json: { success: false, error: "No se pudieron cargar los departamentos." } })
    );
    await page.getByLabel("Base de datos").fill("carto");
    await page.getByLabel("Usuario").fill("reader");
    await page.getByLabel("Contraseña").fill("secreto");

    await page.getByRole("button", { name: "Cargar departamentos" }).click();

    await expect(page.getByText("No se pudieron cargar los departamentos.")).toBeVisible();
    await expect(page.getByLabel("Departamento")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Analizar duplicados" })).toBeEnabled();
  });

  test("debe mostrar el aviso de carga mientras se ejecuta la consulta", async ({ page }) => {
    let releaseResponse: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    await page.route(ANALYZE_URL, async (route) => {
      await gate;
      await route.fulfill({ json: DEDUP_ANALYZE_RESPONSE });
    });

    await fillConnection(page);
    await page.getByRole("button", { name: "Analizar duplicados" }).click();

    await expect(page.getByText(/puede tardar hasta 3 minutos/)).toBeVisible();
    const loadingDialog = page.getByRole("dialog", { name: "Analizando duplicados..." });
    await expect(loadingDialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(loadingDialog).toBeVisible();

    releaseResponse();
    await expect(page.getByRole("tab", { name: "Resumen" })).toBeVisible();
    await expect(loadingDialog).toBeHidden();
  });
});
