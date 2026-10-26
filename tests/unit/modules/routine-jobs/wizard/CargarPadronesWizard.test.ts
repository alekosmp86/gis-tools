import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CargarPadronesWizard } from "@/modules/routine-jobs/ui/CargarPadronesWizard";
import { buttonAttributes, openingTags } from "./wizardFixtures";

const render = (): string => renderToStaticMarkup(React.createElement(CargarPadronesWizard));

describe("CargarPadronesWizard (initial render)", () => {
  it("AC-32: should render on the server without a browser, store snapshot or storage", () => {
    expect(render).not.toThrow();
  });

  it("AC-32: should show the stepper with the five step titles", () => {
    const html = render();

    for (const title of ["Conexión", "Tablas", "Opciones", "Revisar", "Resultado"]) {
      expect(html, title).toContain(title);
    }
  });

  it("AC-32: should open on step 1 of 5", () => {
    expect(render()).toMatch(/Paso\s*(<!-- -->)?1(<!-- -->)?\s*de\s*(<!-- -->)?5/);
  });

  it("AC-32: should show the connection step and none of the later steps", () => {
    const html = render();

    expect(html).toContain("Servidor");
    expect(html).toContain("Base de datos");
    expect(html).not.toContain("Tabla rural");
    expect(html).not.toContain("Reparar geometrías inválidas");
    expect(buttonAttributes(html, "Cargar ahora")).toBeNull();
  });

  it("AC-32: should not make any step clickable on the first step", () => {
    expect(render()).not.toContain('role="button" tabindex="0"');
  });

  it("AC-32: should not show a password or any password text", () => {
    const html = render();

    const passwordInputs = openingTags(html, "input").filter((tag) => tag.includes('type="password"'));
    expect(passwordInputs).toHaveLength(1);
    expect(passwordInputs[0]).not.toMatch(/value="[^"]+"/);
  });

  it("AC-32: should not use inline styles", () => {
    expect(render()).not.toMatch(/\sstyle=/);
  });
});
