/** Click and label behaviour of a map beyond its data. Every flag is off unless a caller turns it on. */
export interface MapInteractionOptions {
  /** Popups on click and on highlight. Default true, so existing previews keep their popups. */
  showPopups?: boolean;
  /** Feature property drawn as a permanent label centred on each feature. */
  labelProperty?: string;
  /** Labels are offset by their `_labelSlot` property and outlined in their feature's colour, and the selected feature keeps that colour. */
  codedLabels?: boolean;
  /** A click on empty map reports null through onSelectFeature. */
  clearOnBackgroundClick?: boolean;
}
