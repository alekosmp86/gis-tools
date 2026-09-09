import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { buildServerStatusSnapshot } from "../serverStatusSnapshot";
import type { ServerStatusResponse } from "../types";

/**
 * `GET /api/m/status`.
 *
 * Thin by design: it reads the process, hands the readings to the builder and serialises the
 * result. It speaks the Web platform Request/Response, never Next types, so the module could be
 * lifted to another host unchanged.
 */
export const readServerStatus: ModuleEndpointHandler = () => {
  const now = new Date();
  const startedAt = new Date(now.getTime() - process.uptime() * 1000);

  const response: ServerStatusResponse = {
    success: true,
    status: buildServerStatusSnapshot({
      startedAt,
      now,
      nodeVersion: process.version,
      rawEnvironment: process.env.NODE_ENV,
    }),
  };

  return Response.json(response);
};
