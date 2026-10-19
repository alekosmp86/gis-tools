import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SavedDbProfile } from "@/core/types/db";
import { ProfileSelect } from "@/ui-kit/components/ProfileSelect";
import { ProfileSelectOption } from "@/ui-kit/components/ProfileSelectOption";
import { SearchInput } from "@/ui-kit/components/ui/SearchInput";

const NEW_LABEL = "Nueva conexión (ingresar datos vacíos)...";

const profile = (id: string, name: string) => ({ id, name }) as unknown as SavedDbProfile;

function renderSelect(profiles: SavedDbProfile[], activeProfileId: string): string {
  return renderToStaticMarkup(
    React.createElement(ProfileSelect, { profiles, activeProfileId, onSelectProfile: () => undefined }),
  );
}

describe("ProfileSelect (closed state)", () => {
  const profiles = [profile("p1", "Dev Norte"), profile("p2", "Producción")];

  it("should show the active profile name on the trigger", () => {
    const html = renderSelect(profiles, "p2");

    expect(html).toContain("Producción");
    expect(html).not.toContain(NEW_LABEL);
  });

  it("should expose the listbox aria attributes while closed", () => {
    const html = renderSelect(profiles, "p1");

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-label="Cargar perfil guardado"');
  });

  it("should show the new-connection label when there is no active profile", () => {
    const html = renderSelect(profiles, "");

    expect(html).toContain(NEW_LABEL);
  });

  it("should show the new-connection label when the active id is unknown", () => {
    const html = renderSelect(profiles, "ghost");

    expect(html).toContain(NEW_LABEL);
    expect(html).not.toContain("Dev Norte");
  });

  it("should not render the dropdown, listbox or search field while closed", () => {
    const html = renderSelect(profiles, "p1");

    expect(html).not.toContain('role="listbox"');
    expect(html).not.toContain('role="option"');
    expect(html).not.toContain("<input");
    expect(html).not.toContain("Buscar conexión");
  });

  it("should render with an empty profiles list", () => {
    const html = renderSelect([], "");

    expect(html).toContain(NEW_LABEL);
    expect(html).toContain('aria-expanded="false"');
  });
});

describe("ProfileSelectOption", () => {
  const render = (overrides: Partial<React.ComponentProps<typeof ProfileSelectOption>> = {}) =>
    renderToStaticMarkup(
      React.createElement(ProfileSelectOption, {
        id: "opt-1",
        icon: React.createElement("i", { "data-testid": "ico" }),
        label: "Mi Perfil",
        isSelected: false,
        isHighlighted: false,
        onSelect: () => undefined,
        ...overrides,
      }),
    );

  it("should render an option button with id, label and icon", () => {
    const html = render();

    expect(html).toContain('role="option"');
    expect(html).toContain('id="opt-1"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('type="button"');
    expect(html).toContain("Mi Perfil");
    expect(html).toContain('data-testid="ico"');
  });

  it("should reflect aria-selected true or false", () => {
    expect(render({ isSelected: true })).toContain('aria-selected="true"');
    expect(render({ isSelected: false })).toContain('aria-selected="false"');
  });

  it("should render the check icon only when selected", () => {
    const svgCount = (html: string) => html.split("<svg").length - 1;

    expect(svgCount(render({ isSelected: false }))).toBe(0);
    expect(svgCount(render({ isSelected: true }))).toBe(1);
  });

  it("should apply the highlighted class only when highlighted", () => {
    const classOf = (html: string) => /class="([^"]*)"/.exec(html)?.[1] ?? "";

    const plain = classOf(render({ isHighlighted: false }));
    const highlighted = classOf(render({ isHighlighted: true }));

    expect(highlighted).not.toBe(plain);
    expect(highlighted).toContain("optionHighlighted");
    expect(plain).not.toContain("optionHighlighted");
  });
});

describe("SearchInput", () => {
  const render = (props: Partial<React.ComponentProps<typeof SearchInput>> = {}) =>
    renderToStaticMarkup(
      React.createElement(SearchInput, { value: "", onChange: () => undefined, ...props }),
    );

  it("should keep the default render free of the new attributes", () => {
    const html = render();

    expect(html).not.toContain("aria-label");
    expect(html).not.toContain("aria-activedescendant");
    expect(html).not.toContain("autofocus");
    expect(html).not.toContain("compact");
    expect(html).toContain('placeholder="Buscar..."');
    expect(html).toContain('type="text"');
  });

  it("should pass aria-label and aria-activedescendant to the input", () => {
    const html = render({ ariaLabel: "Buscar x", ariaActiveDescendant: "opt-2" });

    expect(html).toContain('aria-label="Buscar x"');
    expect(html).toContain('aria-activedescendant="opt-2"');
  });

  it("should apply the compact class only when compact", () => {
    expect(render({ compact: true })).toContain("compact");
    expect(render({ compact: false })).not.toContain("compact");
  });

  it("should show the clear button only when the value is non-empty", () => {
    expect(render({ value: "" })).not.toContain("Limpiar búsqueda");
    expect(render({ value: "dev" })).toContain('aria-label="Limpiar búsqueda"');
  });

  it("should render the given value and placeholder", () => {
    const html = render({ value: "dev", placeholder: "Buscar conexión..." });

    expect(html).toContain('value="dev"');
    expect(html).toContain('placeholder="Buscar conexión..."');
  });
});
