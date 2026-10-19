import path from "node:path";
import type { Locator, Page } from "@playwright/test";

const WIKI_OUTPUT_ROOT = path.join(process.cwd(), "src", "wiki");

const MODULE_WIKI_DIRS: Readonly<Record<string, string>> = {
  "coverage-loads": path.join(process.cwd(), "src", "modules", "coverage-loads", "wiki"),
};

const CLEAN_STYLE_ID = "wiki-shot-clean-style";
const CLEAN_STYLE = `
  nextjs-portal { display: none !important; }
  html { scrollbar-width: none; }
  ::-webkit-scrollbar { display: none; }
`;

export interface ShotOptions {
  tool: string;
  name: string;
  target?: Locator;
}

async function applyCleanStyle(page: Page): Promise<void> {
  await page.evaluate(
    ({ id, css }) => {
      if (document.getElementById(id)) return;
      const style = document.createElement("style");
      style.id = id;
      style.textContent = css;
      document.head.appendChild(style);
    },
    { id: CLEAN_STYLE_ID, css: CLEAN_STYLE }
  );
}

function shotPath(tool: string, name: string): string {
  const contentDir = MODULE_WIKI_DIRS[tool] ?? path.join(WIKI_OUTPUT_ROOT, tool);
  return path.join(contentDir, "images", `${name}.png`);
}

export async function takeShot(page: Page, { tool, name, target }: ShotOptions): Promise<void> {
  await applyCleanStyle(page);
  const options = {
    path: shotPath(tool, name),
    animations: "disabled" as const,
    caret: "hide" as const,
  };
  if (target) {
    await target.screenshot(options);
    return;
  }
  await page.screenshot({ ...options, fullPage: true });
}
