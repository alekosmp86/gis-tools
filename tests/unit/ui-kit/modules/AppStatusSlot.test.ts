import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppStatusSlot } from "@/ui-kit/modules/AppStatusSlot";
import { ModuleContributionsProvider } from "@/ui-kit/modules/ModuleContributionsContext";
import { UiSlot } from "@/ui-kit/modules/contracts";

const Chip: React.FC = () => React.createElement("span", null, "chip-here");

type ProviderProps = React.ComponentProps<typeof ModuleContributionsProvider>;

function renderWith(contributions: ProviderProps["contributions"]): string {
  return renderToStaticMarkup(
    React.createElement(ModuleContributionsProvider, { contributions } as ProviderProps, React.createElement(AppStatusSlot))
  );
}

describe("AppStatusSlot", () => {
  it("should render nothing with no provider", () => {
    expect(renderToStaticMarkup(React.createElement(AppStatusSlot))).toBe("");
  });

  it("should render nothing when only other slots have contributions", () => {
    const html = renderWith([{ slot: UiSlot.HOME_TOOL_GRID, id: "a", order: 1, Component: Chip }]);

    expect(html).toBe("");
  });

  it("should render the contributed chip when an APP_STATUS contribution exists", () => {
    const html = renderWith([{ slot: UiSlot.APP_STATUS, id: "b", order: 1, Component: Chip }]);

    expect(html).toContain("chip-here");
  });
});
