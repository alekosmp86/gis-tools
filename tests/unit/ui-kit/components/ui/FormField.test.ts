import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FormField, type FormFieldProps } from "@/ui-kit/components/ui/FormField";

const SOURCE_PATH = resolve(process.cwd(), "src/ui-kit/components/ui/FormField.tsx");

function render(overrides: Partial<FormFieldProps> = {}): string {
  const props: FormFieldProps = {
    label: "Servidor",
    value: "",
    onChange: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(React.createElement(FormField, props));
}

const inputIdOf = (html: string): string | null => /<input[^>]*\sid="([^"]+)"/.exec(html)?.[1] ?? null;
const labelForOf = (html: string): string | null => /<label[^>]*\sfor="([^"]+)"/.exec(html)?.[1] ?? null;

describe("FormField (static markup)", () => {
  it("AC-32: should bind the label to the input through htmlFor and id", () => {
    const html = render({ id: "campo-host", label: "Servidor" });

    expect(html).toContain('for="campo-host"');
    expect(html).toContain('id="campo-host"');
    expect(html).toContain("Servidor");
  });

  it("AC-32: should bind the label to a generated input id when no id is given", () => {
    const html = render({ label: "Usuario" });

    expect(inputIdOf(html)).not.toBeNull();
    expect(labelForOf(html)).toBe(inputIdOf(html));
  });

  it("AC-32: should show the current value in the input", () => {
    const html = render({ value: "db.local" });

    expect(html).toContain('value="db.local"');
  });

  it("AC-32: should render the same markup with and without the blur and key handlers", () => {
    const plain = render({ id: "campo", value: "x" });
    const withHandlers = render({
      id: "campo",
      value: "x",
      onBlur: () => undefined,
      onKeyDown: () => undefined,
    });

    expect(withHandlers).toBe(plain);
  });

  it("AC-32: should not render any handler attribute into the markup", () => {
    const html = render({ onBlur: () => undefined, onKeyDown: () => undefined });

    expect(html.toLowerCase()).not.toContain("onblur");
    expect(html.toLowerCase()).not.toContain("onkeydown");
  });

  it("AC-32: should render a password input when type is password", () => {
    const html = render({ type: "password", value: "" });

    expect(html).toMatch(/<input[^>]*\stype="password"/);
  });

  it("AC-32: should render a text input by default", () => {
    const html = render();

    expect(html).toMatch(/<input[^>]*\stype="text"/);
  });

  it("AC-32: should render the placeholder when one is given", () => {
    const html = render({ placeholder: "Ej. 5432" });

    expect(html).toContain('placeholder="Ej. 5432"');
  });

  it("AC-32: should render the maximum length when one is given", () => {
    const html = render({ maxLength: 12 });

    expect(html.toLowerCase()).toContain('maxlength="12"');
  });

  it("AC-32: should not emit inline style attributes", () => {
    expect(render({ type: "password", value: "x" })).not.toMatch(/\sstyle=/);
  });

  it("AC-32: should call no callback while rendering statically", () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();

    render({ onChange, onBlur });

    expect(onChange).not.toHaveBeenCalled();
    expect(onBlur).not.toHaveBeenCalled();
  });
});

describe("FormField (source conventions)", () => {
  const source = readFileSync(SOURCE_PATH, "utf8");

  it("AC-32: should declare onBlur and onKeyDown as optional props", () => {
    expect(source).toMatch(/onBlur\?:/);
    expect(source).toMatch(/onKeyDown\?:/);
  });

  it("AC-32: should keep the id prop optional", () => {
    expect(source).toMatch(/\bid\?:\s*string/);
  });
});
