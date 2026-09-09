/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Emitted by scripts/generate-module-routes.cjs from
 * src/modules/cartography-watcher/module.routes.json.
 *
 * Regenerate with `npm run modules:routes`. `npm run modules:routes:check` fails when this tree
 * is stale, so the served surface always matches the declarations that produced it.
 */
import { moduleRegistry } from "@/app/modules.registry";
import { ModuleHttpMethod } from "@/core/modules/contracts";
import { createModuleRouteHandler } from "@/core/modules/createModuleRouteHandler";

const ROUTE_PATH = "cartography-watcher/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createModuleRouteHandler(
  moduleRegistry,
  ModuleHttpMethod.GET,
  ROUTE_PATH
);
