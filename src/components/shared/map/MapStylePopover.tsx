import React from "react";
import { Palette, RotateCcw, Check } from "lucide-react";
import { MapStrokePattern, type MapFeatureStyle } from "@/types/map";
import { MAP_STYLE_PRESET_COLORS } from "@/constants/mapConstants";
import { StyleSliderControl } from "./StyleSliderControl";
import styles from "./MapStylePopover.module.css";

export interface MapStylePopoverProps {
  styleState: MapFeatureStyle;
  onUpdateStyle: (newStyle: MapFeatureStyle) => void;
  onResetStyle: () => void;
  hasDiscrepancies?: boolean;
}

const SWATCH_CLASS_MAP: Record<string, string> = {
  "#06b6d4": styles.swatchCyan,
  "#3b82f6": styles.swatchBlue,
  "#10b981": styles.swatchEmerald,
  "#f59e0b": styles.swatchAmber,
  "#f43f5e": styles.swatchRose,
  "#8b5cf6": styles.swatchViolet,
  "#f8fafc": styles.swatchWhite,
};

export const MapStylePopover: React.FC<MapStylePopoverProps> = ({
  styleState,
  onUpdateStyle,
  onResetStyle,
  hasDiscrepancies = false,
}) => {
  const handleColorChange = (hex: string) => {
    onUpdateStyle({
      ...styleState,
      color: hex,
      fillColor: hex,
    });
  };

  const handleWeightChange = (weight: number) => {
    onUpdateStyle({ ...styleState, weight });
  };

  const handleFillOpacityChange = (fillOpacity: number) => {
    onUpdateStyle({ ...styleState, fillOpacity });
  };

  const handleStrokeOpacityChange = (opacity: number) => {
    onUpdateStyle({ ...styleState, opacity });
  };

  const handleRadiusChange = (pointRadius: number) => {
    onUpdateStyle({ ...styleState, pointRadius });
  };

  const handlePatternChange = (strokePattern: MapStrokePattern) => {
    onUpdateStyle({ ...styleState, strokePattern });
  };

  const handleOverrideToggle = (overrideDiscrepancyColors: boolean) => {
    onUpdateStyle({ ...styleState, overrideDiscrepancyColors });
  };

  return (
    <div className={styles.popoverOverlay}>
      <div className={styles.headerRow}>
        <div className={styles.titleGroup}>
          <Palette size={15} className={styles.titleIcon} />
          <span className={styles.popoverTitle}>Simbología de Capa</span>
        </div>

        <button
          type="button"
          onClick={onResetStyle}
          className={styles.resetBtn}
          title="Restablecer estilos predeterminados"
        >
          <RotateCcw size={12} />
          <span>Restablecer</span>
        </button>
      </div>

      {/* Color Preset Palette */}
      <div className={styles.controlSection}>
        <div className={styles.labelRow}>
          <span className={styles.sectionLabel}>Color Principal:</span>
          <span className={styles.valueBadge}>{styleState.color.toUpperCase()}</span>
        </div>

        <div className={styles.colorSwatches}>
          {MAP_STYLE_PRESET_COLORS.map((preset) => {
            const isSelected = styleState.color.toLowerCase() === preset.hex.toLowerCase();
            const swatchClass = SWATCH_CLASS_MAP[preset.hex] || "";

            return (
              <button
                key={preset.hex}
                type="button"
                className={`${styles.colorSwatch} ${swatchClass} ${isSelected ? styles.activeSwatch : ""}`}
                onClick={() => handleColorChange(preset.hex)}
                title={preset.label}
                aria-label={preset.label}
              >
                {isSelected && <Check size={12} color="#000" />}
              </button>
            );
          })}

          {/* Custom Color Input */}
          <div className={styles.customColorPickerWrapper} title="Elegir color personalizado">
            <input
              type="color"
              value={styleState.color}
              onChange={(event) => handleColorChange(event.target.value)}
              className={styles.nativeColorInput}
              aria-label="Color personalizado"
            />
          </div>
        </div>
      </div>

      {/* Stroke Weight */}
      <StyleSliderControl
        label="Grosor de Línea:"
        valueDisplay={`${styleState.weight} px`}
        min={1}
        max={10}
        step={0.5}
        value={styleState.weight}
        onChange={handleWeightChange}
        ariaLabel="Grosor de línea"
      />

      {/* Fill Opacity */}
      <StyleSliderControl
        label="Opacidad de Relleno:"
        valueDisplay={`${Math.round(styleState.fillOpacity * 100)}%`}
        min={0}
        max={1}
        step={0.05}
        value={styleState.fillOpacity}
        onChange={handleFillOpacityChange}
        ariaLabel="Opacidad de relleno"
      />

      {/* Stroke Opacity */}
      <StyleSliderControl
        label="Opacidad de Trazo:"
        valueDisplay={`${Math.round(styleState.opacity * 100)}%`}
        min={0.1}
        max={1}
        step={0.05}
        value={styleState.opacity}
        onChange={handleStrokeOpacityChange}
        ariaLabel="Opacidad de trazo"
      />

      {/* Point Radius */}
      <StyleSliderControl
        label="Radio de Puntos:"
        valueDisplay={`${styleState.pointRadius} px`}
        min={4}
        max={18}
        step={1}
        value={styleState.pointRadius}
        onChange={handleRadiusChange}
        ariaLabel="Radio de puntos"
      />

      {/* Stroke Pattern */}
      <div className={styles.controlSection}>
        <div className={styles.labelRow}>
          <span className={styles.sectionLabel}>Estilo de Trazo:</span>
        </div>
        <div className={styles.patternBtnGroup}>
          <button
            type="button"
            className={`${styles.patternBtn} ${styleState.strokePattern === MapStrokePattern.SOLID ? styles.activePatternBtn : ""}`}
            onClick={() => handlePatternChange(MapStrokePattern.SOLID)}
          >
            Sólido
          </button>
          <button
            type="button"
            className={`${styles.patternBtn} ${styleState.strokePattern === MapStrokePattern.DASHED ? styles.activePatternBtn : ""}`}
            onClick={() => handlePatternChange(MapStrokePattern.DASHED)}
          >
            Discontinuo
          </button>
          <button
            type="button"
            className={`${styles.patternBtn} ${styleState.strokePattern === MapStrokePattern.DOTTED ? styles.activePatternBtn : ""}`}
            onClick={() => handlePatternChange(MapStrokePattern.DOTTED)}
          >
            Punteado
          </button>
        </div>
      </div>

      {/* Optional: Discrepancy Colors Override Toggle */}
      {hasDiscrepancies && (
        <label className={styles.overrideRow}>
          <input
            type="checkbox"
            checked={styleState.overrideDiscrepancyColors}
            onChange={(event) => handleOverrideToggle(event.target.checked)}
            className={styles.checkbox}
          />
          <span className={styles.overrideLabel}>
            Sobrescribir colores de discrepancia con el color elegido
          </span>
        </label>
      )}
    </div>
  );
};
