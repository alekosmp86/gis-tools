import { NextResponse } from "next/server";
import { moduleRegistry } from "@/services/extensions/moduleRegistry";
import { initializeServerModules } from "@/modules/server";

// Eagerly initialize server module API route handlers once on module load
initializeServerModules();

type HttpMethod = "GET" | "POST";

interface RouteContext {
  params: Promise<{ module: string }>;
}

async function dispatchModuleRequest(
  method: HttpMethod,
  request: Request,
  paramsPromise: Promise<{ module: string }>
): Promise<Response> {
  const { module: moduleId } = await paramsPromise;
  const handler = moduleRegistry.getApi(moduleId);

  if (!handler) {
    return NextResponse.json(
      {
        success: false,
        error: `Módulo API "${moduleId}" no encontrado o no registrado.`,
      },
      { status: 404 }
    );
  }

  const methodHandler = handler[method];
  if (!methodHandler) {
    return NextResponse.json(
      {
        success: false,
        error: `Método HTTP ${method} no soportado para el módulo "${moduleId}".`,
      },
      { status: 405 }
    );
  }

  return methodHandler(request);
}

export async function GET(
  request: Request,
  context: RouteContext
): Promise<Response> {
  return dispatchModuleRequest("GET", request, context.params);
}

export async function POST(
  request: Request,
  context: RouteContext
): Promise<Response> {
  return dispatchModuleRequest("POST", request, context.params);
}
