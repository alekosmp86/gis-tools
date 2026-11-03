import type L from "leaflet";
import type { GeoJsonProperties } from "geojson";
import { getDiscrepancyColor } from "@/core/constants/mapConstants";

const LABEL_CLASS = "map-feature-label";
const COLOR_VARIABLE = "--map-label-color";
const LABEL_SLOT_PROPERTY = "_labelSlot";
const LABEL_STEP_PX = 28;
const FIRST_SLOT_SHIFT_PX = LABEL_STEP_PX / 2;

/** Vertical offset in px of the label in `slot`: slots alternate above and below the centre (-14, +14, -42, +42, ...), so up to six labels never overlap. */
export function labelOffsetOf(slot: number): [number, number] {
  const ring = Math.floor(slot / 2);
  const sign = slot % 2 === 0 ? -1 : 1;
  return [0, sign * (FIRST_SLOT_SHIFT_PX + ring * LABEL_STEP_PX)];
}

export interface FeatureLabelOptions {
  /** Offset each label by its `_labelSlot` property and outline it in the colour of its `_discrepancyType`. */
  coded?: boolean;
}

const slotOf = (properties: GeoJsonProperties): number => {
  const slot = properties?.[LABEL_SLOT_PROPERTY];
  return typeof slot === "number" && slot >= 0 ? Math.floor(slot) : 0;
};

/** Binds a permanent tooltip with the text of `labelProperty`; a feature without that text stays unlabelled. */
export function bindFeatureLabel(
  properties: GeoJsonProperties,
  layer: L.Layer,
  labelProperty: string,
  options: FeatureLabelOptions = {}
): void {
  const text = properties?.[labelProperty];
  if (typeof text !== "string" || text === "") return;
  if (options.coded !== true) {
    layer.bindTooltip(text, { permanent: true, direction: "center", className: LABEL_CLASS });
    return;
  }
  layer.bindTooltip(text, {
    permanent: true,
    direction: "center",
    className: `${LABEL_CLASS} ${LABEL_CLASS}-coded`,
    offset: labelOffsetOf(slotOf(properties)),
  });
  const color = getDiscrepancyColor(properties?._discrepancyType);
  layer.on("tooltipopen", (event: L.TooltipEvent) => {
    event.tooltip.getElement()?.style.setProperty(COLOR_VARIABLE, color);
  });
}
