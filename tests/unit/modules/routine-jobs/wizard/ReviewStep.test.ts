import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReviewStep } from "@/modules/routine-jobs/ui/steps/ReviewStep";
import {
  buttonAttributes,
  isDisabledAttributes,
  openingTags,
  requestOf,
  SECRET,
  withoutValueAttributes,
} from "./wizardFixtures";

type Props = React.ComponentProps<typeof ReviewStep>;

function render(overrides: Partial<Props> = {}): string {
  const props: Props = {
    request: requestOf(),
    confirmation: { password: "", targetLabel: "" },
    confirmed: false,
    busy: false,
    runBlockedReason: null,
    onConfirmationChange: vi.fn(),
    onDryRun: vi.fn(),
    onRun: vi.fn(),
    ...overrides,
  };
  return renderToStaticMarkup(React.createElement(ReviewStep, props));
}

const runButtonDisabled = (html: string): boolean => {
  const attributes = buttonAttributes(html, "Cargar ahora");
  if (attributes === null) throw new Error("Cargar ahora button not found");
  return isDisabledAttributes(attributes);
};

const dryRunButtonDisabled = (html: string): boolean => {
  const attributes = buttonAttributes(html, "Analizar sin cargar");
  if (attributes === null) throw new Error("Analizar sin cargar button not found");
  return isDisabledAttributes(attributes);
};

const BLOCKED_REASON = "Indique el servidor (host).";

describe("ReviewStep", () => {
  describe("summary", () => {
    it("AC-32: should list the server, database and schema", () => {
      const html = render({ request: requestOf({ connection: { host: "srv.test", port: "6543", db_name: "mi_db", user: "ana", password: SECRET } }) });

      expect(html).toContain("srv.test");
      expect(html).toContain("mi_db");
      expect(html).toContain("catastro");
    });

    it("AC-32: should list the three tables", () => {
      const html = render({ request: requestOf({ ruralTable: "t_rural", urbanoTable: "t_urbano", targetTable: "t_destino" }) });

      expect(html).toContain("t_rural");
      expect(html).toContain("t_urbano");
      expect(html).toContain("t_destino");
    });

    it("AC-32: should list the options as chosen", () => {
      const html = render({ request: requestOf({ options: { repair: false, clearMode: "truncate", resetSequences: false } }) });

      expect(html).toContain("Reparar geometrías inválidas");
      expect(html).toContain("Vaciar tabla destino");
      expect(html).toContain("Reiniciar secuencias del destino");
      expect(html).toContain("TRUNCATE");
    });

    it("AC-32: should name DELETE when that is the clear mode", () => {
      const html = render({ request: requestOf({ options: { repair: true, clearMode: "delete", resetSequences: true } }) });

      expect(html).toContain("DELETE");
    });

    it("AC-32: should never print the password in the summary", () => {
      const html = render({ request: requestOf(), confirmation: { password: "", targetLabel: "" } });

      expect(html).not.toContain(SECRET);
    });

    it("AC-32: should never show a retyped password as visible text", () => {
      const html = render({ confirmation: { password: "retyped-pw-7", targetLabel: "" } });

      expect(withoutValueAttributes(html)).not.toContain("retyped-pw-7");
    });

    it("AC-32: should escape table names that contain markup", () => {
      const html = render({ request: requestOf({ targetTable: "<i>x</i>" }) });

      expect(html).not.toContain("<i>x</i>");
    });
  });

  describe("actions", () => {
    it("AC-32: should offer Analizar sin cargar and Cargar ahora", () => {
      const html = render();

      expect(buttonAttributes(html, "Analizar sin cargar")).not.toBeNull();
      expect(buttonAttributes(html, "Cargar ahora")).not.toBeNull();
    });

    it("AC-32: should keep Cargar ahora disabled when not confirmed and not busy", () => {
      expect(runButtonDisabled(render({ confirmed: false, busy: false }))).toBe(true);
    });

    it("AC-32: should enable Cargar ahora when confirmed and not busy", () => {
      expect(runButtonDisabled(render({ confirmed: true, busy: false }))).toBe(false);
    });

    it("AC-32: should disable Cargar ahora while busy even if confirmed", () => {
      expect(runButtonDisabled(render({ confirmed: true, busy: true }))).toBe(true);
    });

    it("AC-32: should explain that a run is in progress when busy", () => {
      const html = render({ busy: true });

      expect(html).toContain("Hay una carga en curso. Espere a que termine para iniciar otra.");
    });

    it("AC-32: should not show the in-progress note when not busy", () => {
      const html = render({ busy: false });

      expect(html).not.toContain("Hay una carga en curso");
    });

    it("AC-32: should disable Cargar ahora while busy and not confirmed", () => {
      expect(runButtonDisabled(render({ confirmed: false, busy: true }))).toBe(true);
    });

    it("AC-32: should not need confirmation to analyze without loading", () => {
      const attributes = buttonAttributes(render({ confirmed: false, busy: false }), "Analizar sin cargar");

      expect(attributes).not.toBeNull();
      expect(isDisabledAttributes(attributes ?? "")).toBe(false);
    });
  });

  describe("run blocked reason", () => {
    it("AC-32: should disable Analizar sin cargar when the run is blocked", () => {
      expect(dryRunButtonDisabled(render({ runBlockedReason: BLOCKED_REASON }))).toBe(true);
    });

    it("AC-32: should disable Cargar ahora when the run is blocked even if confirmed and not busy", () => {
      expect(runButtonDisabled(render({ runBlockedReason: BLOCKED_REASON, confirmed: true, busy: false }))).toBe(true);
    });

    it("AC-32: should show the blocked reason exactly once", () => {
      const html = render({ runBlockedReason: BLOCKED_REASON });

      expect(html.split(BLOCKED_REASON).length - 1).toBe(1);
    });

    it("AC-32: should enable Analizar sin cargar when nothing blocks the run and nothing is busy", () => {
      expect(dryRunButtonDisabled(render({ runBlockedReason: null, busy: false }))).toBe(false);
    });

    it("AC-32: should disable Analizar sin cargar while busy even when nothing blocks the run", () => {
      expect(dryRunButtonDisabled(render({ runBlockedReason: null, busy: true }))).toBe(true);
    });

    it("AC-32: should not show a blocked reason when the reason is null", () => {
      expect(render({ runBlockedReason: null })).not.toContain(BLOCKED_REASON);
    });
  });

  describe("confirmation", () => {
    it("AC-32: should ask to retype the password in a password input", () => {
      const html = render();

      expect(html).toMatch(/contraseña/i);
      expect(openingTags(html, "input").filter((tag) => tag.includes('type="password"'))).toHaveLength(1);
    });

    it("AC-32: should ask to retype the destination table name", () => {
      const html = render({ confirmation: { password: "", targetLabel: "padron_tecleado" } });

      expect(html).toMatch(/tabla destino/i);
      expect(html).toContain('value="padron_tecleado"');
    });
  });

  describe("destructive warning", () => {
    it("AC-32: should warn that the destination table will be emptied, naming the table", () => {
      const html = render({ request: requestOf({ targetTable: "padron_destino" }) });

      expect(html).toMatch(/vaciar/i);
      expect(html.split("padron_destino").length - 1).toBeGreaterThanOrEqual(2);
    });

    it("AC-32: should name the clear mode in the warning", () => {
      const deleteHtml = render({ request: requestOf({ options: { repair: true, clearMode: "delete", resetSequences: true } }) });
      const truncateHtml = render({ request: requestOf({ options: { repair: true, clearMode: "truncate", resetSequences: true } }) });

      expect(deleteHtml.split("DELETE").length - 1).toBeGreaterThanOrEqual(2);
      expect(truncateHtml.split("TRUNCATE").length - 1).toBeGreaterThanOrEqual(2);
    });
  });

  it("AC-32: should not use inline styles", () => {
    expect(render({ confirmed: true })).not.toMatch(/\sstyle=/);
  });
});
