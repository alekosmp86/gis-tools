import type { Feature, Geometry, GeoJsonProperties } from "geojson";
import { getDiscrepancyColor, getDiscrepancyLabel } from "@/constants/mapConstants";

export function buildPopupHtml(feature: Feature<Geometry, GeoJsonProperties>): string {
  if (!feature.properties) return "";
  const props = feature.properties;
  const discType = props._discrepancyType;
  const discColor = getDiscrepancyColor(discType);
  const typeLabel = getDiscrepancyLabel(discType);
  const titleProp =
    props.nombre || props.name || props.reftramo || props.suid || props.id || "Entidad Espacial";
  const noteText = props._discrepancyNote
    ? `<div style="color: #64748b; font-size: 11px; margin-top: 4px;">${props._discrepancyNote}</div>`
    : "";

  const subProps = Object.entries(props)
    .filter(
      ([k]) =>
        !k.startsWith("_") &&
        !/^(geom|geometry|wkt|wkb|wkb_geometry)$/i.test(k.trim())
    )
    .slice(0, 6)
    .map(([k, v]) => {
      const rawValStr = String(v);
      const displayVal =
        rawValStr.length > 45 ? `${rawValStr.substring(0, 42)}...` : rawValStr;
      return `<strong>${k}:</strong> <span style="word-break: break-all;">${displayVal}</span>`;
    })
    .join("<br/>");

  return (
    `<div style="font-family: sans-serif; font-size: 12px; color: #0f172a; max-width: 280px; overflow-wrap: break-word;">` +
    `<div style="display: inline-block; padding: 2px 8px; border-radius: 4px; background: ${discColor}; color: #fff; font-weight: bold; font-size: 10px; margin-bottom: 6px;">${typeLabel}</div><br/>` +
    `<strong style="color: #0284c7; font-size: 13px;">${titleProp}</strong>` +
    `${noteText}` +
    `<hr style="margin: 6px 0; border: none; border-top: 1px solid #cbd5e1;"/>` +
    `${subProps}</div>`
  );
}
