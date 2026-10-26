import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StartRequest } from "@/modules/routine-jobs/ui/clientTypes";
import { OptionsStep } from "@/modules/routine-jobs/ui/steps/OptionsStep";
import { openingTags } from "./wizardFixtures";

type Options = StartRequest["options"];

const DEFAULT_OPTIONS: Options = { repair: true, clearMode: "delete", resetSequences: true };

const render = (options: Options): string =>
  renderToStaticMarkup(React.createElement(OptionsStep, { options, onChange: vi.fn() }));

const isMarked = (tag: string): boolean => /\s(checked|selected)(=""|\s|>|\/)/.test(tag);

const checkboxes = (html: string): string[] => openingTags(html, "input").filter((tag) => tag.includes('type="checkbox"'));

function markedClearModes(html: string): string[] {
  const candidates = [...openingTags(html, "input"), ...openingTags(html, "option")];
  return ["delete", "truncate"].filter((mode) => candidates.some((tag) => tag.includes(`value="${mode}"`) && isMarked(tag)));
}

describe("OptionsStep", () => {
  it("AC-32: should show the three options with their Spanish labels", () => {
    const html = render(DEFAULT_OPTIONS);

    expect(html).toContain("Reparar geometrías inválidas");
    expect(html).toContain("Vaciar tabla destino");
    expect(html).toContain("Reiniciar secuencias del destino");
  });

  it("AC-32: should offer DELETE and TRUNCATE as the ways to empty the target", () => {
    const html = render(DEFAULT_OPTIONS);

    expect(html).toContain('value="delete"');
    expect(html).toContain('value="truncate"');
    expect(html).toContain("DELETE");
    expect(html).toContain("TRUNCATE");
  });

  it("AC-32: should render the two toggles checked when both are on", () => {
    const [repair, sequences] = checkboxes(render(DEFAULT_OPTIONS));

    expect(isMarked(repair)).toBe(true);
    expect(isMarked(sequences)).toBe(true);
  });

  it("AC-32: should render the repair toggle unchecked when repair is off", () => {
    const boxes = checkboxes(render({ ...DEFAULT_OPTIONS, repair: false }));

    expect(boxes).toHaveLength(2);
    expect(isMarked(boxes[0])).toBe(false);
    expect(isMarked(boxes[1])).toBe(true);
  });

  it("AC-32: should render the sequence toggle unchecked when resetSequences is off", () => {
    const boxes = checkboxes(render({ ...DEFAULT_OPTIONS, resetSequences: false }));

    expect(isMarked(boxes[0])).toBe(true);
    expect(isMarked(boxes[1])).toBe(false);
  });

  it("AC-32: should render both toggles unchecked when both are off", () => {
    const boxes = checkboxes(render({ repair: false, clearMode: "delete", resetSequences: false }));

    expect(boxes.some(isMarked)).toBe(false);
  });

  it("AC-32: should select DELETE only when the clear mode is delete", () => {
    expect(markedClearModes(render({ ...DEFAULT_OPTIONS, clearMode: "delete" }))).toEqual(["delete"]);
  });

  it("AC-32: should select TRUNCATE only when the clear mode is truncate", () => {
    expect(markedClearModes(render({ ...DEFAULT_OPTIONS, clearMode: "truncate" }))).toEqual(["truncate"]);
  });

  it("AC-32: should explain that TRUNCATE needs its privilege and locks the table when it is selected", () => {
    const html = render({ ...DEFAULT_OPTIONS, clearMode: "truncate" });

    expect(html).toMatch(/privilegio/i);
    expect(html).toMatch(/bloque/i);
  });

  it("AC-32: should not use inline styles", () => {
    expect(render({ ...DEFAULT_OPTIONS, clearMode: "truncate" })).not.toMatch(/\sstyle=/);
  });
});
