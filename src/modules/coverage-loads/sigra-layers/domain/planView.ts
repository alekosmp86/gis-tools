import type { SigraPlan } from "../types";

/** Plan blockers that are not already shown on a layer row (those start with the layer label). */
export function listGeneralBlockers(plan: SigraPlan): string[] {
  const layerPrefixes = plan.layers.map((layer) => `${layer.label}: `);
  return plan.blockers.filter((blocker) => !layerPrefixes.some((prefix) => blocker.startsWith(prefix)));
}
