# ISSUE 032: Persistencia Server-Side de Fuentes Cartográficas (SRP) en Vault

## 1. Problem Statement
Previamente, el módulo de Observador Cartográfico (`cartography-watcher`) almacenaba las fuentes personalizadas configuradas por el usuario exclusivamente en el almacenamiento local del navegador (`localStorage` bajo la clave `gis_watched_cartography_sources_v1`).

Esto provocaba las siguientes limitaciones críticas:
1. **Desincronización con el Catálogo de Sincronización Espacial**: Cuando las herramientas de sincronización (DB-CSV y DB-Shapefile) consultaban el árbol de recursos del catálogo abierto (`getCatalogTree`), la llamada ocurría en el servidor Next.js, el cual no tenía acceso al `localStorage` del navegador y únicamente cargaba la constante estática `DEFAULT_WATCHED_SOURCES`. Como resultado, las fuentes agregadas por el usuario nunca aparecían en el catálogo de archivos disponibles para sincronizar.
2. **Pérdida de Fuentes entre Navegadores y Dispositivos**: Las fuentes no persistían en modo incógnito, ni al cambiar de navegador, ni entre diferentes usuarios en la misma red local.

## 2. Root Cause Analysis & Technical Details
- **Ausencia de Capa de Persistencia en Servidor para Fuentes**: Aunque `VaultStorageService` manejaba la persistencia en disco de archivos binarios descargados (`data/vault/<slug>/`), no existía un servicio dedicado a la persistencia del listado de fuentes configuradas (`sources.json`).
- **Violación Potencial de SRP**: Integrar la lógica de gestión de fuentes dentro de `VaultStorageService` habría sobrecargado su responsabilidad única (almacenamiento de archivos binarios y metadatos de recursos individuales).
- **Desacoplamiento de Orquestador y Catálogo**: `WatcherOrchestrator.getCatalogTree()` tenía como valor por defecto `DEFAULT_WATCHED_SOURCES` en lugar de resolver dinámicamente las fuentes persistidas.

## 3. Implemented Solution

1. **Nuevo Servicio de Persistencia (`WatchedSourcesStorageService.ts`)**:
   - Se creó `WatchedSourcesStorageService` con la responsabilidad exclusiva de leer, guardar, agregar y remover fuentes en `data/vault/sources.json`.
   - Implementa tolerancia a fallos: retorna `DEFAULT_WATCHED_SOURCES` si el archivo no existe o contiene JSON corrupto.
   - Preserva las fuentes predeterminadas del sistema e impide su eliminación accidental.

2. **Inyección de Dependencia en `WatcherOrchestrator.ts`**:
   - Se inyectó `WatchedSourcesStorageService` en el constructor de `WatcherOrchestrator`.
   - Se expusieron los métodos `getWatchedSources()`, `addWatchedSource(portalUrl)` y `removeWatchedSource(sourceId)`.
   - Se actualizó `getCatalogTree()` para que, en ausencia de una lista explícita de fuentes, resuelva dinámicamente las fuentes persistidas en el servidor (`this.sourcesStorage.loadSources()`).

3. **Exposición en la Capa de Controladores (`CartographyWatcherController.ts`)**:
   - Se definió el enum tipado `WatcherApiAction` en `src/modules/cartography-watcher/types/watcher.ts`.
   - Se reemplazaron las cadenas de `if` lineales por tablas de despacho $O(1)$ (`getActionHandlers` y `postActionHandlers`), aplicando el patrón **Dispatch Table / Command**:
     - `WatcherApiAction.SOURCES` ➔ `getSources()`
     - `WatcherApiAction.CATALOG_TREE` ➔ `getCatalogTree(searchParams)`
     - `WatcherApiAction.CATALOG_FILE` / `VAULT_FILE` ➔ `getCatalogFile(searchParams)`
     - `WatcherApiAction.SUMMARIES` ➔ `getSummaries(searchParams)`
     - `WatcherApiAction.ADD_SOURCE` ➔ `postAddSource(body.url)`
     - `WatcherApiAction.REMOVE_SOURCE` ➔ `postRemoveSource(body.sourceId)`
     - `WatcherApiAction.DOWNLOAD` ➔ `downloadResource(body.url, body.resourceId)`
   - Validación rigurosa de parámetros y respuestas HTTP tipadas con códigos de estado (`400`, `200`, `500`).

4. **Cliente API y Hook React (`watcherApi.ts` & `useWatchedSources.ts`)**:
   - Se crearon `fetchPersistedSourcesApi()`, `addCustomSourceApi(url)` y `removeCustomSourceApi(sourceId)`, consumiendo `WatcherApiAction`.
   - `useWatchedSources` se reconcilia al montar el componente con las fuentes del servidor mediante `fetchPersistedSourcesApi()`, actualizando tanto el estado React como `localStorage` de manera optimista.
   - Las adiciones y eliminaciones se propagan inmediatamente al backend en disco.

5. **Pruebas Unitarias Herméticas (`WatchedSourcesStorageService.test.ts`)**:
   - Cobertura completa de casos de uso: fallback a fuentes por defecto, serialización en disco, sobreescritura de slugs existentes y protección contra borrado de fuentes del sistema.

## 4. Code Examples & Diff Snippets

### A. Servicio `WatchedSourcesStorageService.ts`
```typescript
export class WatchedSourcesStorageService {
  public async loadSources(): Promise<WatchedSourceConfig[]> {
    try {
      if (!fs.existsSync(this.sourcesFilePath)) {
        return [...DEFAULT_WATCHED_SOURCES];
      }
      const rawJson = await fs.promises.readFile(this.sourcesFilePath, "utf-8");
      const parsedSources = JSON.parse(rawJson) as WatchedSourceConfig[];
      // Garantizar que las fuentes predeterminadas siempre estén presentes
      const existingIds = new Set(parsedSources.map((s) => s.id));
      const missingDefaults = DEFAULT_WATCHED_SOURCES.filter((d) => !existingIds.has(d.id));
      return [...missingDefaults, ...parsedSources];
    } catch {
      return [...DEFAULT_WATCHED_SOURCES];
    }
  }
}
```

### B. Despacho $O(1)$ sin `if` redundantes en `CartographyWatcherController.ts`
```typescript
// Tabla de despacho (Command / Dispatch Table pattern)
private readonly getActionHandlers: Record<
  string,
  (searchParams: URLSearchParams) => Promise<Response>
> = {
  [WatcherApiAction.SOURCES]: () => this.getSources(),
  [WatcherApiAction.CATALOG_TREE]: (searchParams) => this.getCatalogTree(searchParams),
  [WatcherApiAction.CATALOG_FILE]: (searchParams) => this.getCatalogFile(searchParams),
  [WatcherApiAction.VAULT_FILE]: (searchParams) => this.getCatalogFile(searchParams),
  [WatcherApiAction.SUMMARIES]: (searchParams) => this.getSummaries(searchParams),
};

public async handleGet(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const actionName = searchParams.get("action");
    const targetHandler = actionName ? this.getActionHandlers[actionName] : undefined;

    if (targetHandler) {
      return await targetHandler(searchParams);
    }
    return await this.checkSource(searchParams);
  } catch (error) {
    // ...
  }
}
```

## 5. Verification & Testing

1. **Pruebas Automatizadas de Calidad**:
   - `npm run lint`: 0 errores, 0 advertencias.
   - `npm run doctor`: 100/100 mantenibilidad.
   - `npm run build`: Compilación exitosa en Turbopack.
   - `npm run graph`: 0 ciclos detectados en el grafo de dependencias.

2. **Pruebas Unitarias**:
   - `WatchedSourcesStorageService.test.ts` verifica el fallback a valores por defecto, guardado/lectura en directorio temporal y rechazo al eliminar fuentes por defecto.
