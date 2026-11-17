import L from "leaflet";
import type { GeoJsonProperties } from "geojson";
import { getDiscrepancyColor } from "@/core/constants/mapConstants";

const LABEL_CLASS = "map-feature-label";
const POINT_LABEL_CLASS = `${LABEL_CLASS}-point`;
const COLOR_VARIABLE = "--map-label-color";
const LABEL_SLOT_PROPERTY = "_labelSlot";
const LABEL_STEP_PX = 28;
const FIRST_SLOT_SHIFT_PX = LABEL_STEP_PX / 2;
const POINT_LABEL_GAP_PX = 7;

/** Vertical offset in px of the label in `slot`: slots alternate above and below the centre (-14, +14, -42, +42, ...), so up to six labels never overlap. */
export function labelOffsetOf(slot: number): [number, number] {
  const ring = Math.floor(slot / 2);
  const sign = slot % 2 === 0 ? -1 : 1;
  return [0, sign * (FIRST_SLOT_SHIFT_PX + ring * LABEL_STEP_PX)];
}

/** Offset in px that lifts a label's bottom edge just above a point marker's outer stroke edge. */
function pointLabelOffsetOf(radius: number, strokeWeight: number): [number, number] {
  return [0, -(radius + strokeWeight / 2 + POINT_LABEL_GAP_PX)];
}

export interface FeatureLabelOptions {
  /** Offset each line label by its `_labelSlot` property, sit each point label just above its marker, and outline each label in the colour of its `_discrepancyType`. */
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
  if (layer instanceof L.CircleMarker) {
    layer.bindTooltip(text, {
      permanent: true,
      direction: "top",
      className: `${LABEL_CLASS} ${LABEL_CLASS}-coded ${POINT_LABEL_CLASS}`,
      offset: pointLabelOffsetOf(layer.getRadius(), layer.options.weight ?? 0),
    });
  } else {
    layer.bindTooltip(text, {
      permanent: true,
      direction: "center",
      className: `${LABEL_CLASS} ${LABEL_CLASS}-coded`,
      offset: labelOffsetOf(slotOf(properties)),
    });
  }
  const color = getDiscrepancyColor(properties?._discrepancyType);
  layer.on("tooltipopen", (event: L.TooltipEvent) => {
    event.tooltip.getElement()?.style.setProperty(COLOR_VARIABLE, color);
  });
}
