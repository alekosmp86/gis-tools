import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Cable } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { StageStatus } from "@/modules/coverage-loads/shared/domain/stageContract";
import type { CoverageStage } from "@/modules/coverage-loads/workflow/ui/coverageStages";
import { StageView } from "@/modules/coverage-loads/workflow/ui/StageView";

const CONNECTION = { host: "h", port: "5432", db_name: "d", user: "u", password: "" };
const NOTICE = "Complete primero Capas SIGRA para habilitar este paso.";
const HIDDEN_PANEL = /<div[^>]*\bhidden\b[^>]*>\s*<span>PANEL-STUB/;
const VISIBLE_PANEL = /<div(?![^>]*\bhidden\b)[^>]*>\s*<span>PANEL-STUB/;

const STAGE: CoverageStage = {
  id: "avance-ftth",
  label: "Avance FTTH",
  Icon: Cable,
  Panel: () => React.createElement("span", null, "PANEL-STUB"),
};

function render(overrides: Partial<React.ComponentProps<typeof StageView>> = {}): string {
  return renderToStaticMarkup(
    React.createElement(StageView, {
      stage: STAGE,
      status: StageStatus.PENDING,
      isActive: true,
      canSkip: true,
      canUnskip: false,
      lockedNotice: null,
      connection: CONNECTION,
      connectionRevision: 0,
      onStatusChange: vi.fn(),
      onSkip: vi.fn(),
      onUnskip: vi.fn(),
      ...overrides,
    })
  );
}

describe("StageView locking (AC-11)", () => {
  describe("when the stage is locked", () => {
    it("should show the lock notice", () => {
      // Arrange & Act
      const html = render({ lockedNotice: NOTICE });

      // Assert
      expect(html).toContain(`<p`);
      expect(html).toContain(NOTICE);
    });

    it("should keep the panel mounted but hide its wrapper", () => {
      // Arrange & Act
      const html = render({ lockedNotice: NOTICE });

      // Assert
      expect(html).toContain("PANEL-STUB");
      expect(html).toMatch(HIDDEN_PANEL);
    });

    it("should still offer Omitir when the stage can be skipped", () => {
      // Arrange & Act
      const html = render({ lockedNotice: NOTICE, canSkip: true });

      // Assert
      expect(html).toContain("Omitir");
    });
  });

  describe("when the stage is not locked", () => {
    it("should show no lock notice and a visible panel wrapper", () => {
      // Arrange & Act
      const html = render({ lockedNotice: null });

      // Assert
      expect(html).not.toContain(NOTICE);
      expect(html).not.toMatch(HIDDEN_PANEL);
      expect(html).toMatch(VISIBLE_PANEL);
    });

    it("should keep hiding the panel of a skipped stage, as before", () => {
      // Arrange & Act
      const html = render({ status: StageStatus.SKIPPED, canSkip: false, canUnskip: true });

      // Assert
      expect(html).toMatch(HIDDEN_PANEL);
      expect(html).toContain("Retomar");
    });
  });

  describe("Omitir button", () => {
    it("should be present when canSkip is true", () => {
      // Arrange & Act
      const html = render({ canSkip: true });

      // Assert
      expect(html).toContain("Omitir");
    });

    it("should be absent when canSkip is false", () => {
      // Arrange & Act
      const html = render({ canSkip: false });

      // Assert
      expect(html).not.toContain("Omitir");
    });
  });

  describe("header", () => {
    it("should show the stage label and use no inline styles", () => {
      // Arrange & Act
      const html = render({ lockedNotice: NOTICE });

      // Assert
      expect(html).toContain("Avance FTTH");
      expect(html).not.toContain("style=");
    });
  });
});
