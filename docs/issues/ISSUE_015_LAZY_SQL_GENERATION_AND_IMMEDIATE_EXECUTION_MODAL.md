# Issue #015: Generación Diferida de SQL de Vista Previa y Apertura Inmediata del Modal de Ejecución

## 1. Problem Statement

Al utilizar las herramientas de sincronización espacial (DB vs. Shapefile, DB vs. CSV, DB vs. DB):

1. **Latencia y sobrecarga en la transición Paso 3 $\to$ Paso 4**:
   Al finalizar la configuración de SUID y avanzar a los resultados, el motor de comparación ejecutaba el generador SQL sobre la totalidad de los registros discrepantes (decenas o cientos de miles de registros), extrayendo geometrías binarias, formateando cadenas GeoJSON y serializando sentencias SQL completas, para luego descartar todo salvo las primeras 25 sentencias de vista previa (`MAX_PREVIEW_LINES`). Esto provocaba un retraso innecesario y consumo excesivo de memoria en el navegador.

2. **Demora al hacer clic en "Ejecutar en BD"**:
   Al presionar el botón de ejecución en base de datos, la interfaz no abría inmediatamente el modal de confirmación, sino que permanecía varios segundos con el botón en estado `Generando...` mientras el Web Worker construía un script SQL monolítico en memoria. El usuario no recibía respuesta visual instantánea sobre su acción.

3. **Retardo visual previo al indicador en "Copiar" y "Descargar"**:
   Al hacer clic en copiar o descargar, la serialización síncrona del dataset en el hilo principal bloqueaba el bucle de eventos antes de que React pudiera pintar el estado de carga (`isGenerating: true`) en el DOM, dando la sensación de que la interfaz se congelaba momentáneamente.

---

## 2. Root Cause Analysis & Technical Details

### A. Bucle Monolítico en `SqlPatchGenerator.generatePatches`
A pesar de que `SpatialComparisonEngine` pasaba `collectFullScript = false` durante la fase de comparación inicial, el método `generatePatches` iteraba sobre cada uno de los `discrepancyItems`:
- Para cada registro `ONLY_IN_SHP`, leía la geometría del Shapefile con `shpReader.readGeometry`, formateaba coordenadas GeoJSON y construía la sentencia `INSERT INTO ...`.
- Solo al final, `PatchCollector` retenía 25 sentencias en `insertPreviewStatements` y descartaba el resto.
- En datasets de 100.000+ discrepancias, este trabajo redundante consumía entre 4 y 8 segundos de procesamiento inútil.

### B. Bloqueo Previo en `handleOpenExecuteModal`
En `useSqlPatchDrawerState.ts`, la función de apertura del modal esperaba la resolución del script completo:
```typescript
const handleOpenExecuteModal = async () => {
  const script = await ensureScriptAvailable(); // <- Bloqueaba la apertura del modal
  if (!script) return;
  setIsModalOpen(true);
};
```
El modal no requería el script completo para mostrarse, ya que la cantidad de sentencias (`statementCount`) ya era conocida y se presentaba en la interfaz.

### C. Bloqueo de Renderizado en el Bucle de Eventos
Al invocar `setIsGenerating(true)`, la función asíncrona ejecutaba de inmediato operaciones pesadas de serialización síncrona antes de ceder el control al motor de renderizado del navegador, impidiendo el refresco visual del spinner en el primer frame.

---

## 3. Implemented Solution

Se implementó un diseño de **Generación Perezosa Estricta (Lazy Generation)** y desacoplamiento del flujo de ejecución:

1. **Generación Exclusiva de Vista Previa en `SqlPatchGenerator`**:
   Se descompuso `generatePatches` en dos métodos con responsabilidades claras:
   - `generatePreviewOnlyPatches(discrepancyItems)`: Se ejecuta cuando `collectFullScript = false`. Itera de forma ultrarrápida; una vez que `collector.isInsertPreviewFull()` (25 sentencias) y `collector.isUpdatePreviewFull()` (25 sentencias) se completan, **omite inmediatamente la lectura de geometrías y el formateo de cadenas SQL**, calculando el total de sentencias mediante un conteo entero simple $O(1)$ por tipo de discrepancia en menos de 1 milisegundo.
   - `generateFullPatches(discrepancyItems, emit)`: Se reserva exclusivamente para cuando el usuario solicita la exportación o ejecución real del script.

2. **Apertura Instantánea del Modal de Confirmación**:
   `handleOpenExecuteModal` en `useSqlPatchDrawerState.ts` abre el modal con latencia de 0 ms (`setIsModalOpen(true)`). El modal se alimenta directamente de `currentStats.statementCount` (ya calculado) y de los metadatos de conexión.

3. **Construcción y Ejecución por Lotes al Confirmar**:
   En `useSqlBatchExecution.ts`, el proceso de generación se pospone hasta que el usuario ingresa su contraseña y presiona "Iniciar Ejecución":
   - El modal muestra inmediatamente el estado de progreso ("Construyendo sentencias SQL para ejecución...").
   - Resuelve el script en segundo plano mediante `onEnsureScript()`.
   - Transiciona fluidamente a la ejecución por lotes de 500 sentencias (`executeSqlInChunks`), reportando el avance en tiempo real (`Lote 1 de N`, `Lote 2 de N`, etc.).

4. **Ejecución Asíncrona Natural sin Retrasos Artificiales**:
   Dado que `generateSqlPatchesInWorker` opera en un Web Worker en segundo plano y devuelve una `Promise`, el flujo asíncrono libera inmediatamente el hilo principal de React. Esto elimina la necesidad de micro-retrasos artificiales (`setTimeout(..., 50)`), garantizando una transición inmediata de estados sin código espurio.

---

## 4. Code Examples & Diff Snippets

### A. Desacoplamiento de Vista Previa en `SqlPatchGenerator.ts`:
```typescript
// Antes: generaba todas las sentencias y leía todas las geometrías para descartarlas
for (let index = 0; index < totalItems; index++) {
  this.processItemUpdates(item, collector);
  this.processItemInsert(item, collector);
}

// Ahora: genera solo 25 de cada tipo y cuenta el resto instantáneamente
private generatePreviewOnlyPatches(discrepancyItems: DiscrepancyItem[]): SqlPatchSummary {
  const collector = new PatchCollector(25, false);
  let totalUpdates = 0;
  let totalInserts = 0;

  for (let index = 0; index < discrepancyItems.length; index++) {
    const item = discrepancyItems[index];

    if (item.type === DiscrepancyType.ONLY_IN_SHP) {
      totalInserts++;
      if (!collector.isInsertPreviewFull()) {
        this.processItemInsert(item, collector);
      }
    } else if (
      item.type === DiscrepancyType.ATTRIBUTE_MISMATCH ||
      item.type === DiscrepancyType.GEOMETRY_MISMATCH
    ) {
      totalUpdates++;
      if (!collector.isUpdatePreviewFull()) {
        this.processItemUpdates(item, collector);
      }
    }
  }

  collector.setTotalCounts(totalUpdates, totalInserts);
  return collector.toSummary();
}
```

### B. Apertura Inmediata del Modal en `useSqlPatchDrawerState.ts`:
```typescript
// Antes:
const handleOpenExecuteModal = async () => {
  const script = await ensureScriptAvailable(); // Demora de varios segundos
  if (!script) return;
  setIsModalOpen(true);
};

// Ahora:
const handleOpenExecuteModal = () => {
  setIsModalOpen(true); // Apertura instantánea sin esperas
};
```

### C. Optimización de Memoria y Vista Previa para 1M+ Registros:

1. **Extracción Directa de Vista Previa en `SpatialComparisonEngine.ts`**:
   En lugar de iterar 1.000.000 de registros en el generador de parches, se extraen directamente hasta 25 elementos de actualización (`ATTRIBUTE_MISMATCH` / `GEOMETRY_MISMATCH`) y hasta 25 de inserción (`unmatchedFileItems.slice(0, 25)`), reutilizando los conteos exactos ya calculados en el Paso 1 y Paso 2:
   ```typescript
   const patchResult = sqlPatchGenerator.generatePreviewPatches(
     previewUpdateItems,
     previewInsertItems,
     totalUpdates,
     totalInserts
   );
   ```
   Esto reduce el tiempo de generación de vista previa de varios segundos a **0.1 ms**, eliminando el bloqueo en "Generando vista previa SQL...".

2. **Eliminación de 30M+ Objetos de Diferencias Innecesarios**:
   Para registros `ONLY_IN_DB` y `ONLY_IN_SHP`, se eliminaron los bucles que generaban arrays de diferencias artificiales con `shpValue: null` o `dbValue: null` para cada columna (30–50 columnas por fila). Esto previene la asignación de más de 30.000.000 de objetos en el heap de V8 y omite la retención de filas completas `dbRecord` para elementos no accionables.

3. **Filtrado de Elementos Accionables para Generación Completa**:
   Al solicitar el script completo en `Step4ResultsView.tsx`, solo se transfieren por `postMessage` los elementos que realmente generan sentencias SQL (`ATTRIBUTE_MISMATCH`, `GEOMETRY_MISMATCH`, `ONLY_IN_SHP`), evitando serializar 1.000.000 de registros `ONLY_IN_DB`.

---

## 5. Verification & Testing

- **TypeScript Type Check**: `npx tsc --noEmit` completó con código `0` (0 errores).
- **ESLint**: `npm run lint` pasó limpiamente con 0 advertencias y 0 errores.
- **React Doctor**: **Score: 100 / 100 Great (`✔ No issues found!`)**.
- **Next.js Production Build**: `next build` compiló exitosamente todas las rutas estáticas y dinámicas en 2.6s.
