/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Emitted by scripts/generate-module-routes.cjs from
 * src/modules/cartography-watcher/module.routes.json.
 *
 * Regenerate with `npm run modules:routes`. `npm run modules:routes:check` fails when this tree
 * is stale, so the served surface always matches the declarations that produced it.
 */
import { notFound } from "next/navigation";
import { moduleRegistry } from "@/app/modules.registry";
import { ModuleErrorBoundary } from "@/ui-kit/modules/ModuleErrorBoundary";

const PAGE_ROUTE_PATH = "cartography-watcher";

export const metadata = {
  title: "Observador de Actualizaciones Cartográficas",
};

export default function ModuleOwnedPage() {
  const registeredPage = moduleRegistry.findPage(PAGE_ROUTE_PATH);

  if (!registeredPage) {
    notFound();
  }

  const ModuleOwnedPageContent = registeredPage.page.Component;

  return (
    <ModuleErrorBoundary contributionId={PAGE_ROUTE_PATH}>
      <ModuleOwnedPageContent />
    </ModuleErrorBoundary>
  );
}
