import type { Feature, Geometry, GeoJsonProperties } from "geojson";
import { getDiscrepancyColor, getDiscrepancyLabel } from "@/constants/mapConstants";

/**
 * MapPopupPresenter
 * Object-Oriented Presenter constructing HTML cards and popup metadata views for Leaflet vector layers.
 */
export class MapPopupPresenter {
  /**
   * Builds sanitized HTML markup with styled badges and attributes for a clicked spatial feature.
   */
  public buildPopupHtml(feature: Feature<Geometry, GeoJsonProperties>): string {
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
        ([keyName]) =>
          !keyName.startsWith("_") &&
          !/^(geom|geometry|wkt|wkb|wkb_geometry)$/i.test(keyName.trim())
      )
      .slice(0, 6)
      .map(([keyName, value]) => {
        const rawValStr = String(value);
        const displayVal =
          rawValStr.length > 45 ? `${rawValStr.substring(0, 42)}...` : rawValStr;
        return `<strong>${keyName}:</strong> <span style="word-break: break-all;">${displayVal}</span>`;
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

  public static buildPopupHtml(feature: Feature<Geometry, GeoJsonProperties>): string {
    const presenter = new MapPopupPresenter();
    return presenter.buildPopupHtml(feature);
  }
}

/** Convenience export */
export const buildPopupHtml = MapPopupPresenter.buildPopupHtml;
