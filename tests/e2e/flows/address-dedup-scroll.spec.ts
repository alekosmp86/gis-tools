import { test, expect } from "../support/testFixture";
import type { Locator, Page } from "@playwright/test";
import { DEDUP_ANALYZE_RESPONSE, DEDUP_GROUP_COUNT } from "../fixtures/dedupFixtures";

const PAGE_URL = "/tools/m/address-dedup";
const ANALYZE_URL = "**/api/m/address-dedup/analyze";
const MIN_TOP_BAR_HEIGHT_PX = 12;
const HEADER_SCROLL_OFFSET_PX = 400;
const DESKTOP_VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
] as const;

test.use({
  launchOptions: {
    args: ["--enable-features=OverlayScrollbar"],
    ignoreDefaultArgs: ["--hide-scrollbars"],
  },
});

async function openGroupsTab(page: Page): Promise<void> {
  await page.route(ANALYZE_URL, (route) => route.fulfill({ json: DEDUP_ANALYZE_RESPONSE }));
  await page.goto(PAGE_URL);
  await expect(page.getByRole("button", { name: "Analizar duplicados" })).toBeEnabled();
  for (const [label, value] of [
    ["Base de datos", "carto"],
    ["Usuario", "reader"],
    ["Contraseña", "secreto"],
  ] as const) {
    const input = page.getByLabel(label);
    await input.fill(value);
    await expect(input).toHaveValue(value);
  }
  await page.getByRole("button", { name: "Analizar duplicados" }).click();
  await page.getByRole("tab", { name: `Grupos (${DEDUP_GROUP_COUNT})` }).click();
  await expect(page.getByTestId("dedup-scroll-content")).toBeVisible();
}

async function measureFrame(page: Page) {
  return page.getByTestId("dedup-scroll-content").evaluate((content) => {
    const frame = content.parentElement as HTMLElement;
    const top = frame.firstElementChild as HTMLElement;
    return {
      viewportWidth: window.innerWidth,
      frameRight: frame.getBoundingClientRect().right,
      contentScrollWidth: content.scrollWidth,
      contentClientWidth: content.clientWidth,
      topHeight: top.getBoundingClientRect().height,
      topDisplay: getComputedStyle(top).display,
      pageOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
}

async function leftOfHeaderToggle(page: Page): Promise<{ toggleLeft: number; frameLeft: number; frameRight: number }> {
  const toggle: Locator = page.getByRole("button", { name: /Grupo 1/ });
  const box = await toggle.boundingBox();
  const frameBox = await page.getByTestId("dedup-scroll-content").boundingBox();
  if (!box || !frameBox) throw new Error("missing boxes");
  return { toggleLeft: box.x, frameLeft: frameBox.x, frameRight: frameBox.x + frameBox.width };
}

test.describe("Duplicados de Direcciones: barras de desplazamiento en escritorio", () => {
  for (const viewport of DESKTOP_VIEWPORTS) {
    test(`debe contener el marco y mostrar la barra superior a ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openGroupsTab(page);

      const metrics = await measureFrame(page);

      expect(metrics.frameRight).toBeLessThanOrEqual(metrics.viewportWidth);
      expect(metrics.contentScrollWidth).toBeGreaterThan(metrics.contentClientWidth);
      expect(metrics.topDisplay).not.toBe("none");
      expect(metrics.topHeight).toBeGreaterThanOrEqual(MIN_TOP_BAR_HEIGHT_PX);
      expect(metrics.pageOverflows).toBe(false);
    });

    test(`debe sincronizar las barras a ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openGroupsTab(page);
      const topScroller = page.getByTestId("dedup-scroll-top");
      const contentScroller = page.getByTestId("dedup-scroll-content");

      await topScroller.evaluate((element) => {
        element.scrollLeft = 200;
      });

      await expect
        .poll(() => contentScroller.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(150);
    });

    test(`debe mantener visible la etiqueta del grupo al desplazar a ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openGroupsTab(page);
      const contentScroller = page.getByTestId("dedup-scroll-content");

      await contentScroller.evaluate((element, offset) => {
        element.scrollLeft = offset;
      }, HEADER_SCROLL_OFFSET_PX);
      await expect
        .poll(() => contentScroller.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(HEADER_SCROLL_OFFSET_PX - 50);

      const { toggleLeft, frameLeft, frameRight } = await leftOfHeaderToggle(page);
      expect(toggleLeft).toBeGreaterThanOrEqual(frameLeft - 1);
      expect(toggleLeft).toBeLessThan(frameRight);
    });
  }
});
