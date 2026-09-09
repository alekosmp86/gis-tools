# ISSUE_018: Inversión de Dependencias y Ciclos Circulares entre Capa de Tipos y Capa de Servicios

## 1. Problem Statement

Durante el análisis estático automatizado de la arquitectura del proyecto `gis-tools` mediante el generador de grafos de dependencias, se detectaron **2 ciclos de dependencia circulares** activos en la base de código que involucraban contratos de dominio y la infraestructura de ejecución de Web Workers:

- **Ciclo 1**: `src/types/comparison.ts` ➔ `src/services/workerBridge.ts` ➔ `src/types/comparison.ts`
- **Ciclo 2**: `src/types/comparison.ts` ➔ `src/services/workerBridge.ts` ➔ `src/types/workerMessages.ts` ➔ `src/types/comparison.ts`

Este acoplamiento circular violaba el principio de inversión de dependencias y la separación estricta de capas arquitectónicas establecida en el proyecto: la capa base de tipos (`src/types/`) no debe depender de módulos superiores en `src/services/` ni en `src/workers/`.

---

## 2. Root Cause Analysis & Technical Details

### A. Inversión del Contrato de Callback
En `src/types/comparison.ts`, la interfaz `IComparisonEngine` requería un parámetro opcional `onProgress?: ProgressCallback`.
Sin embargo, el tipo `ProgressCallback` estaba declarado y exportado en `src/services/workerBridge.ts`:

```typescript
// src/services/workerBridge.ts
export type ProgressCallback = (phase: string, current: number, total: number) => void;
```

Y en consecuencia, `src/types/comparison.ts` importaba dicho tipo desde la capa de servicios:

```typescript
// src/types/comparison.ts (Línea 3)
import type { ProgressCallback } from "@/services/workerBridge";
```

### B. Flujo de Datos y Cierre del Ciclo
Simultáneamente, el servicio `src/services/workerBridge.ts` necesitaba tipar sus parámetros de entrada y retorno importando contratos de datos desde `src/types/comparison.ts`:

```typescript
// src/services/workerBridge.ts (Línea 1)
import type { ComparisonSummary, SqlPatchSummary } from "@/types/comparison";
```

Esto cerraba un ciclo directo de importación bidireccional entre `types/comparison.ts` y `services/workerBridge.ts`. Adicionalmente, múltiples motores y lectores de streaming (`DatabaseStreamReader.ts`, `DbVsDbComparisonEngine.ts`, `DbVsFileComparisonEngine.ts`, `comparisonWorkerSync.ts`) importaban `ProgressCallback` de `workerBridge`, propagando el acoplamiento cruzado de capas.

---

## 3. Implemented Solution

Para restaurar una arquitectura unidireccional y limpia:

1. **Reubicación de `ProgressCallback` en la Capa de Tipos (`src/types/comparison.ts`)**:
   Se trasladó la definición formal de `ProgressCallback` a `src/types/comparison.ts`, considerándolo un contrato de dominio de progreso para cualquier motor de comparación (`IComparisonEngine`). Se eliminó completamente la importación de `@/services/workerBridge` en `src/types/comparison.ts`.

2. **Consumo Directo sin Re-exportación en `src/services/workerBridge.ts`**:
   `workerBridge.ts` ahora únicamente importa `ProgressCallback` desde `@/types/comparison` para su propio uso interno. Se eliminó cualquier re-exportación innecesaria en la capa de servicios, respetando la regla de código limpio y eliminación de exportaciones muertas.

3. **Actualización de Motores y Servicios Dependientes**:
   Se actualizaron todas las importaciones en `DatabaseStreamReader.ts`, `DbVsDbComparisonEngine.ts`, `DbVsFileComparisonEngine.ts` y `comparisonWorkerSync.ts` para que apunten directamente a la fuente formal en `@/types/comparison`.

4. **Integración Permanente del Generador de Grafos**:
   Se crearon los scripts `scripts/generate-dependency-graph.cjs` y `scripts/serve-dependency-graph.cjs`, agregando los comandos `"graph"` y `"graph:serve"` a `package.json` para permitir la auditoría continua del grafo en futuras iteraciones.

---

## 4. Code Examples & Diff Snippets

### A. Corrección en `src/types/comparison.ts`

```diff
  import type { DbConfig } from "@/types/db";
  import type { ParsedFileDataset } from "@/types/parsers";
- import type { ProgressCallback } from "@/services/workerBridge";
+ 
+ export type ProgressCallback = (phase: string, current: number, total: number) => void;
 
  export interface InsertFieldDefault {
```

### B. Corrección en `src/services/workerBridge.ts`

```diff
- import type { ComparisonSummary, SqlPatchSummary } from "@/types/comparison";
- export type ProgressCallback = (phase: string, current: number, total: number) => void;
+ import type { ComparisonSummary, SqlPatchSummary, ProgressCallback } from "@/types/comparison";
```

---

## 5. Verification & Testing

### A. Auditoría Automatizada de Ciclos
Ejecución del script `node scripts/generate-dependency-graph.cjs`:
- **Archivos Analizados**: 145
- **Conexiones Detectadas**: 381
- **Ciclos Resultantes**: **0** (Reducción de 2 a 0 ciclos).

### B. Pruebas de Compilación y Calidad
1. `npm run doctor`: Verificación de componentes React y árbol de renderizado sin advertencias.
2. `npm run lint`: Verificación estricta de ESLint pasada exitosamente.
3. `npm run build`: Compilación de producción de Next.js (`next build`) completada con éxito.
4. `http://localhost:3000/dependency-graph.html`: Acceso verificado con código de estado HTTP 200.
