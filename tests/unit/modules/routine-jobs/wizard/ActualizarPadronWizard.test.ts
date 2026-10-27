import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ActualizarPadronWizard from "@/modules/routine-jobs/ui/ActualizarPadronWizard";
import { buttonAttributes, openingTags } from "./wizardFixtures";

const render = (): string => renderToStaticMarkup(React.createElement(ActualizarPadronWizard));

describe("ActualizarPadronWizard (initial render)", () => {
  it("AP-27: should render on the server without a browser, store snapshot or storage", () => {
    expect(render).not.toThrow();
  });

  it("AP-27: should show the stepper with the five step titles", () => {
    const html = render();

    for (const title of ["Conexión", "Tablas", "Opciones", "Revisar", "Resultado"]) {
      expect(html, title).toContain(title);
    }
  });

  it("AP-27: should open on step 1 of 5", () => {
    expect(render()).toMatch(/Paso\s*(<!-- -->)?1(<!-- -->)?\s*de\s*(<!-- -->)?5/);
  });

  it("AP-28: should show the shared connection fields and none of the later steps", () => {
    const html = render();

    expect(html).toContain("Servidor");
    expect(html).toContain("Base de datos");
    expect(html).not.toContain("Tabla de origen");
    expect(html).not.toContain("Vaciar tabla de trabajo");
    expect(buttonAttributes(html, "Actualizar tabla de trabajo")).toBeNull();
  });

  it("AP-28: should show a single password field and no password value", () => {
    const html = render();
    const passwordInputs = openingTags(html, "input").filter((tag) => tag.includes('type="password"'));

    expect(passwordInputs).toHaveLength(1);
    expect(passwordInputs[0]).not.toMatch(/value="[^"]+"/);
  });

  it("AP-32: should not use inline styles", () => {
    expect(render()).not.toMatch(/\sstyle=/);
  });
});
