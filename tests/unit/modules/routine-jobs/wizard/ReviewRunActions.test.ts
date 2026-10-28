import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PASSWORD_LABEL, ReviewRunActions, type ReviewRunActionsProps } from "@/modules/routine-jobs/ui/steps/reviewParts";
import { buttonAttributes, isDisabledAttributes } from "./wizardFixtures";

const DRY_LABEL = "Analizar sin cargar";
const RUN_LABEL = "Completar unidades territoriales";
const DRY_HINT = "DRY-HINT";
const RUN_HINT = "RUN-HINT";
const BUSY_NOTE = "BUSY-NOTE";
const BLOCKED = "BLOCKED-REASON";

function propsOf(overrides: Partial<ReviewRunActionsProps> = {}): ReviewRunActionsProps {
  return {
    dryRunHint: DRY_HINT,
    runHint: RUN_HINT,
    busyNote: BUSY_NOTE,
    runLabel: RUN_LABEL,
    busy: false,
    runBlockedReason: null,
    canDryRun: true,
    canRun: true,
    onDryRun: vi.fn(),
    onRun: vi.fn(),
    ...overrides,
  };
}

const render = (overrides: Partial<ReviewRunActionsProps> = {}): string =>
  renderToStaticMarkup(React.createElement(ReviewRunActions, propsOf(overrides)));

const disabledOf = (html: string, label: string): boolean => {
  const attributes = buttonAttributes(html, label);
  if (attributes === null) throw new Error(`${label} button not found`);
  return isDisabledAttributes(attributes);
};

describe("ReviewRunActions (shared review part)", () => {
  it("should show both hints and the run label of the stage", () => {
    const html = render();

    expect(html).toContain(DRY_HINT);
    expect(html).toContain(RUN_HINT);
    expect(html).toContain(DRY_LABEL);
    expect(html).toContain(RUN_LABEL);
  });

  it("should enable the dry run only when it can run", () => {
    expect(disabledOf(render({ canDryRun: true }), DRY_LABEL)).toBe(false);
    expect(disabledOf(render({ canDryRun: false }), DRY_LABEL)).toBe(true);
  });

  it("should enable the real run only when it can run", () => {
    expect(disabledOf(render({ canRun: true }), RUN_LABEL)).toBe(false);
    expect(disabledOf(render({ canRun: false }), RUN_LABEL)).toBe(true);
  });

  it("should show the busy note and disable both runs while busy", () => {
    const html = render({ busy: true });

    expect(html).toContain(BUSY_NOTE);
    expect(disabledOf(html, DRY_LABEL)).toBe(true);
    expect(disabledOf(html, RUN_LABEL)).toBe(true);
  });

  it("should show the blocked reason and disable both runs when the wizard blocks the run", () => {
    const html = render({ runBlockedReason: BLOCKED });

    expect(html).toContain(BLOCKED);
    expect(disabledOf(html, DRY_LABEL)).toBe(true);
    expect(disabledOf(html, RUN_LABEL)).toBe(true);
  });

  it("should show no busy note and no blocked reason when neither applies", () => {
    const html = render();

    expect(html).not.toContain(BUSY_NOTE);
    expect(html).not.toContain(BLOCKED);
  });

  it("should use no inline styles", () => {
    expect(render()).not.toMatch(/\sstyle=/);
  });
});

describe("PASSWORD_LABEL (shared review part)", () => {
  it("should keep the Spanish password field label used by every review step", () => {
    expect(PASSWORD_LABEL).toBe("Contraseña de la base de datos");
  });
});
