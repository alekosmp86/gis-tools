import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConnectionStep } from "@/modules/routine-jobs/ui/steps/ConnectionStep";
import { connectionOf, openingTags, profileOf, SECRET, withoutValueAttributes } from "./wizardFixtures";

type Props = React.ComponentProps<typeof ConnectionStep>;

function render(overrides: Partial<Props> = {}): string {
  const props: Props = {
    connection: connectionOf(),
    profiles: [],
    activeProfile: "",
    onFieldChange: vi.fn(),
    onSelectProfile: vi.fn(),
    onSaveProfile: vi.fn(),
    onDeleteProfile: vi.fn(),
    blockingReason: null,
    ...overrides,
  };
  return renderToStaticMarkup(React.createElement(ConnectionStep, props));
}

describe("ConnectionStep", () => {
  describe("fields", () => {
    it("AC-32: should label the five connection fields in Spanish", () => {
      const html = render();

      for (const label of ["Servidor", "Puerto", "Base de datos", "Usuario", "Contraseña"]) {
        expect(html, label).toContain(label);
      }
    });

    it("AC-32: should show the current values of host, port, database and user in the inputs", () => {
      const html = render({ connection: connectionOf({ host: "10.1.2.3", port: "6543", db_name: "mi_base", user: "ana" }) });

      for (const value of ["10.1.2.3", "6543", "mi_base", "ana"]) {
        expect(html, value).toContain(`value="${value}"`);
      }
    });

    it("AC-32: should render the password field as a password input", () => {
      const html = render();

      const passwordInputs = openingTags(html, "input").filter((tag) => tag.includes('type="password"'));
      expect(passwordInputs).toHaveLength(1);
    });

    it("AC-32: should never print the password as visible text", () => {
      const html = render({ connection: connectionOf({ password: SECRET }) });

      expect(withoutValueAttributes(html)).not.toContain(SECRET);
    });

    it("AC-32: should render empty inputs when every field is empty", () => {
      const html = render({ connection: connectionOf({ host: "", port: "", db_name: "", user: "", password: "" }) });

      expect(html).toContain("Servidor");
      expect(openingTags(html, "input").length).toBeGreaterThanOrEqual(5);
    });

    it("AC-32: should escape markup typed into a field", () => {
      const html = render({ connection: connectionOf({ host: '"><script>alert(1)</script>' }) });

      expect(html).not.toContain("<script>");
    });
  });

  describe("blocking reason", () => {
    it("AC-32: should show the Spanish blocking reason when there is one", () => {
      const html = render({ blockingReason: "Indique el servidor (host)." });

      expect(html).toContain("Indique el servidor (host).");
    });

    it("AC-32: should show no blocking text when the reason is null", () => {
      const html = render({ blockingReason: null });

      expect(html).not.toContain("Indique");
    });

    it("AC-32: should escape a blocking reason that contains markup", () => {
      const html = render({ blockingReason: "<b>x</b>" });

      expect(html).not.toContain("<b>x</b>");
    });
  });

  describe("profiles", () => {
    it("AC-32: should show the active saved profile in the shared profile selector", () => {
      const html = render({ profiles: [profileOf("Mensual dev"), profileOf("Mensual preprod")], activeProfile: "Mensual dev" });

      expect(html).toContain("Cargar perfil guardado");
      expect(html).toContain("Mensual dev");
    });

    it("AC-32: should offer the profile controls with an empty profile list", () => {
      const html = render({ profiles: [] });

      expect(html).toMatch(/perfil/i);
      expect(html).toMatch(/guardar/i);
    });

    it("AC-32: should render a long profile list", () => {
      const profiles = Array.from({ length: 60 }, (_, index) => profileOf(`Perfil ${String(index).padStart(2, "0")}`));

      const html = render({ profiles, activeProfile: "Perfil 59" });

      expect(html).toContain("Perfil 59");
    });

    it("AC-32: should offer to delete the active profile", () => {
      const html = render({ profiles: [profileOf("Mensual dev")], activeProfile: "Mensual dev" });

      expect(html).toMatch(/eliminar|borrar/i);
    });
  });

  it("AC-32: should not use inline styles", () => {
    const html = render({ profiles: [profileOf("A")], blockingReason: "x" });

    expect(html).not.toMatch(/\sstyle=/);
  });
});
