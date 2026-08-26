# Arquitectura, Desafíos Técnicos y Estado del Proyecto: GIS Tools

Este documento reúne la arquitectura general, decisiones de diseño, patrones aplicados, procesamiento en segundo plano (Web Workers), desafíos técnicos resueltos y la hoja de ruta de desarrollo de la plataforma **GIS Tools**.

---

## 📋 1. Visión General del Proyecto

**GIS Tools** es un portal web modular de alta velocidad diseñado para la auditoría, correlación, análisis de discrepancias y sincronización de información alfanumérica y espacial entre **bases de datos PostgreSQL/PostGIS** y **fuentes de datos externas** (archivos Shapefile `.zip`, `.geojson` y archivos alfanuméricos `.csv`).

### Principios de Diseño
1. **Procesamiento 100% en Memoria Local del Navegador**: Ningún archivo cargado (`.zip`, `.shp`, `.csv`) se almacena en disco de servidores o tablas temporales de base de datos. Toda la inspección ocurre en la memoria RAM del navegador.
2. **Arquitectura Multihilo (Web Workers)**: Las operaciones pesadas de cómputo (indexado, búsqueda $O(1)$, comparación de miles de registros) se ejecutan en hilos Web Worker en segundo plano, evitando bloquear la interfaz de usuario.
3. **Componentes Atómicos y Reglas Estrictas**: Separación estricta entre interfaces UI, hooks de estado, tipos TypeScript y servicios de dominio.
4. **Escalabilidad mediante Patrones de Diseño**: Uso del **Patrón Estrategia (Strategy Pattern)** para añadir nuevos formatos de archivos o motores de comparación sin modificar el código existente.
5. **Cero Pérdida de Datos en Auditoría**: Detección explícita y reporte de registros con SUIDs Nulos/Vacíos y SUIDs Duplicados.
6. **Manejo Inteligente de Restricciones `NOT NULL` y Claves Compuestas**: Introspección de metadatos de columnas en PostgreSQL (`information_schema.columns`) y soporte de claves SUID compuestas por múltiples columnas.
7. **Rendimiento UI con Paginación de Discrepancias**: Paginación de alta velocidad en la tabla de resultados para renderizar únicamente el bloque activo de filas (50 / 100 / 250 / 500), garantizando fluidez instantánea sin congelar el DOM.

---

## 🏛️ 2. Decisiones de Arquitectura

### A. Patrón Estrategia (Strategy Pattern)
Para independizar la carga de archivos, la correlación de datos y la interfaz de usuario, se definieron interfaces orientadas a objetos en TypeScript:

1. **Interfaz `ISpatialFileParser` ([`src/types/parsers.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/parsers.ts))**:
   - Abstrae el parseo de cualquier formato a un modelo unificado `ParsedFileDataset`.
   - **`ShapefileParser`** ([`src/services/parsers/ShapefileParser.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/parsers/ShapefileParser.ts)): Parsea archivos `.zip` (SHP+DBF) y `.geojson` en memoria.
   - **`CsvParser`** ([`src/services/parsers/CsvParser.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/parsers/CsvParser.ts)): Parsea archivos `.csv` alfanuméricos delimitados por comas en memoria.

2. **Interfaz `IComparisonEngine` ([`src/types/comparison.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/comparison.ts))**:
   - Abstrae la lógica de comparación de datos.
   - **`DbVsFileComparisonEngine`** ([`src/services/engines/DbVsFileComparisonEngine.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/engines/DbVsFileComparisonEngine.ts)): Orquestador liviano que delega la comparación al Web Worker en segundo plano.

---

### B. Arquitectura Asíncrona con Web Workers

```
  [Hilo Principal de UI (React)]
            │
            ├─ 1. fetch("/api/db/records")   ──▶ Servidor PostgreSQL (I/O Red)
            │
            ├─ 2. serializeFileDataset()     ──▶ Convierte Map<> a Objeto plano (Serializable)
            │
            └─ 3. postMessage() ────────────▶ [Hilo Secundario: Web Worker]
                                                  ├─ Fase 1: Indexado DB Compuesto (SuidMap + Nulls)
                                                  ├─ Fase 2: Indexado Archivo Compuesto (SuidMap + Nulls)
                                                  ├─ Fase 3: Pre-cálculo O(1) de Mapa de Columnas
                                                  ├─ Fase 4: Comparación Atributos (UPDATE)
                                                  ├─ Fase 5: Generación Inserciones (INSERT) + Defaults
                                                  └─ postMessage({ type: 'DONE', payload })
                                                                │
                                                                ▼
                                                      [Resolución de Promise / Render UI]
```

- **`src/types/workerMessages.ts`**: Protocolo de mensajes fuertemente tipado (`WorkerInputMessage`, `WorkerProgressMessage`, `WorkerDoneMessage`, `WorkerErrorMessage`).
- **`src/workers/comparisonWorker.ts`**: Web Worker dedicado que realiza el procesamiento $O(N)$ sin congelar la UI.
- **`src/workers/comparisonWorkerSync.ts`**: Reemplazo sincrónico para entornos SSR donde Web Workers no estén disponibles.
- **`src/services/workerBridge.ts`**: Adaptador basado en `Promise` con serialización `serializeFileDataset` y fallback automático.
- **`src/hooks/useComparisonProgress.ts`** & **`src/components/shared/ProgressBar.tsx`**: Hook y componente UI con barra de progreso en tiempo real y contador de registros procesados.

---

### C. Claves Identificadoras SUID Compuestas (Multicolumna)

- Permite seleccionar **una o múltiples columnas** de la base de datos (ej. `departamento` + `padron`) en [`SuidSelectorCard.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/tools/db-shapefile-sync/SuidSelectorCard.tsx).
- El Web Worker construye claves hash compuestas unificando las columnas limpiadas (`val1_val2`) para indexación $O(1)$.
- Genera cláusulas `WHERE` multicolumna en SQL: `WHERE "depto" = '01' AND "padron" = '45012'`.
- Al generar sentencias `INSERT`, se incluyen automáticamente todas las columnas componentes de la clave SUID compuesta.

---

### D. Generación Dual de Scripts SQL (UPDATE e INSERT) e Introspección `NOT NULL`

El motor clasifica las diferencias y genera dos scripts SQL PostGIS independientes:

1. **Script de Actualización (`sqlUpdateScript`)**:
   - Diseñado para registros existentes en ambos orígenes pero con valores dispares en atributos.
   - Sintaxis: `UPDATE "esquema"."tabla" SET "columna" = valor WHERE "suid_col1" = 'val1' AND "suid_col2" = 'val2';`
2. **Script de Inserción (`sqlInsertScript`)**:
   - Diseñado para registros presentes en el archivo fuente que NO existen en la base de datos.
   - Sintaxis: `INSERT INTO "esquema"."tabla" ("suid_col1", "suid_col2", "col1", "col2", "col_default") VALUES ('val1', 'val2', val1, val2, val_def);`
   - **Soporte de Campos Faltantes y Restricciones `NOT NULL`**: A través del componente [`InsertDefaultsCard.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/tools/db-shapefile-sync/InsertDefaultsCard.tsx), el usuario puede asignar valores estáticos (ej. `'ACTIVO'`, `'SISTEMA'`) o expresiones SQL (ej. `NOW()`) a columnas no mapeadas que sean obligatorias en PostgreSQL.
3. **Interfaz de Usuario ([`SqlPatchDrawer.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/tools/db-shapefile-sync/SqlPatchDrawer.tsx))**:
   - Pestañas independientes (Cyan para UPDATE, Verde para INSERT) con botones dedicados para copiar al portapapeles o descargar archivos `.sql`.

---

### E. Auditoría Completa de SUIDs (Nulos y Duplicados)

Para evitar pérdidas silenciosas de datos en tablas PostGIS o archivos fuente:

1. **`DiscrepancyType.NULL_SUID`**: Agrupa registros donde alguna de las columnas SUID compuestas es `NULL` o vacía.
2. **`DiscrepancyType.DUPLICATE_SUID`**: Agrupa registros con claves SUID repetidas, preservando todas sus ocurrencias mediante estructuras `Map<string, Array<Record>>`.
3. **Barra de Resumen de KPIs ([`DiscrepanciesSummaryBar.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/tools/db-shapefile-sync/DiscrepanciesSummaryBar.tsx))**:
   - Desglose del Total Evaluados (`DB: 230.000 | Archivo: 69.083`).
   - Tarjetas KPI con badges interactivos para filtrar SUIDs Nulos y SUIDs Duplicados.

---

## 📂 3. Mapa de Archivos por Áreas y Módulos

### Módulo de Dominio y Tipos (`src/types/`)
- [`src/types/db.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/db.ts): Interfaces de configuración PostgreSQL (`DbConfig`, `DbColumnMetadata`).
- [`src/types/parsers.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/parsers.ts): Interfaces `ParsedFileDataset` e `ISpatialFileParser`.
- [`src/types/comparison.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/comparison.ts): Enums y modelos de discrepancias (`ComparisonSummary`, `DiscrepancyItem`, `DiscrepancyType`, `DiscrepancyFilter`).
- [`src/types/workerMessages.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/workerMessages.ts): Protocolo de mensajes del Web Worker.
- [`src/types/ui.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/ui.ts): Variantes de botones, badges y tipos de alerta.
- [`src/types/gis.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/gis.ts): Modelos para el catálogo de herramientas, `ColumnMappingConfig` (soporte de `suidColumns` compuestas) y `InsertFieldDefault`.

### Motores y Parseadores (`src/services/`)
- [`src/services/engines/DbVsFileComparisonEngine.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/engines/DbVsFileComparisonEngine.ts): Estrategia de comparación PostGIS vs Archivo.
- [`src/services/workerBridge.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/workerBridge.ts): Puente de comunicación Promise / Worker con fallback SSR.
- [`src/services/parsers/ShapefileParser.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/parsers/ShapefileParser.ts): Parser para `.zip` (SHP+DBF) y `.geojson`.
- [`src/services/parsers/CsvParser.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/parsers/CsvParser.ts): Parser para `.csv` delimitado por comas.
- [`src/services/localStorageDbConfig.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/localStorageDbConfig.ts): Persistencia local de credenciales (excluye contraseñas).

### Hilos Web Worker (`src/workers/`)
- [`src/workers/comparisonWorker.ts`](file:///c:/Alekos/Projects/gis-tools/src/workers/comparisonWorker.ts): Hilo secundario de comparación asíncrona (soporta SUID compuesto).
- [`src/workers/comparisonWorkerSync.ts`](file:///c:/Alekos/Projects/gis-tools/src/workers/comparisonWorkerSync.ts): Fallback sincrónico en caso de SSR.

### Utilidades y Helpers (`src/utils/`)
- [`src/utils/gisCleaners.ts`](file:///c:/Alekos/Projects/gis-tools/src/utils/gisCleaners.ts): Normalización de cadenas, limpieza de comillas (`cleanValue`) y claves SUID (`cleanSuid`).

### Hooks Personalizados (`src/hooks/`)
- [`src/hooks/useDbConnectionForm.ts`](file:///c:/Alekos/Projects/gis-tools/src/hooks/useDbConnectionForm.ts): Lógica del formulario de conexión DB con hidratación post-montaje.
- [`src/hooks/useDbQueries.ts`](file:///c:/Alekos/Projects/gis-tools/src/hooks/useDbQueries.ts): Consultas a la API con TanStack React Query.
- [`src/hooks/useComparisonProgress.ts`](file:///c:/Alekos/Projects/gis-tools/src/hooks/useComparisonProgress.ts): Seguimiento de progreso del Web Worker.
- [`src/hooks/useSuidMappingForm.ts`](file:///c:/Alekos/Projects/gis-tools/src/hooks/useSuidMappingForm.ts): Lógica del mapa de columnas SUID (compuestas), atributos y campos por defecto.

### Componentes UI Reutilizables (`src/components/shared/`)
- [`src/components/shared/DbConnectionForm.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/shared/DbConnectionForm.tsx): Paso 1 compartido (Conexión e introspección DB con metadatos de columnas).
- [`src/components/shared/StepIndicator.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/shared/StepIndicator.tsx): Indicador visual de los 4 pasos del Wizard.
- [`src/components/shared/ProgressBar.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/shared/ProgressBar.tsx): Barra de progreso animada por fases.
- [`src/components/shared/PaginationControls.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/shared/PaginationControls.tsx): Control de paginación reutilizable (botones primera/anterior/siguiente/última, selector de filas por página y contador de registros).
- [`src/components/shared/ColumnsList.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/shared/ColumnsList.tsx): Visualizador de columnas inspeccionadas.
- [`src/components/shared/AlertMessage.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/shared/AlertMessage.tsx): Mensajes de estado y alerta.

### Componentes de Herramientas (`src/components/tools/`)
- **DB vs Shapefile**:
  - `ShapefileUploader.tsx`: Dropzone para archivos `.zip` / `.geojson`.
  - `SuidMappingStep.tsx`: Formulario de correspondencia SUID, Atributos e Inserciones `NOT NULL`.
  - `SuidSelectorCard.tsx`: Selector interactivo de columnas SUID únicas o compuestas.
  - `InsertDefaultsCard.tsx`: Tarjeta de configuración de valores por defecto e inserciones para campos faltantes.
  - `Step4ResultsView.tsx`: Panel principal de resultados de comparación.
  - `DiscrepanciesSummaryBar.tsx`: Tarjetas KPI de resumen.
  - `DiscrepanciesTable.tsx`: Tabla filtrable y paginada de discrepancias (50 / 100 / 250 / 500 por página).
  - `SqlPatchDrawer.tsx`: Visor con pestañas de scripts SQL (UPDATE e INSERT).
- **DB vs CSV**:
  - `CsvUploader.tsx`: Dropzone e inspección de encabezados `.csv`.
  - `CsvSuidMappingStep.tsx`: Mapeo de columnas CSV vs DB (soporta SUID compuesto).

### Rutas de API y Páginas (`src/app/`)
- [`src/app/api/db/columns/route.ts`](file:///c:/Alekos/Projects/gis-tools/src/app/api/db/columns/route.ts): Endpoint de introspección de columnas con metadatos de restricciones (`is_nullable`, `column_default`).
- [`src/app/api/db/records/route.ts`](file:///c:/Alekos/Projects/gis-tools/src/app/api/db/records/route.ts): Endpoint de consulta ilimitada de registros PostGIS (sin tope de 10k).
- [`src/app/tools/db-shapefile-sync/page.tsx`](file:///c:/Alekos/Projects/gis-tools/src/app/tools/db-shapefile-sync/page.tsx): Wizard de Sincronización DB vs. Shapefile.
- [`src/app/tools/db-csv-sync/page.tsx`](file:///c:/Alekos/Projects/gis-tools/src/app/tools/db-csv-sync/page.tsx): Wizard de Sincronización DB vs. CSV.

---

## ⚡ 4. Desafíos Técnicos y Soluciones Aplicadas

### Desafío 1: Renderizado de Tablas Masivas (75.000+ Filas) y Límite de Registros DB
- **Problema**: Renderizar 75.000+ filas DOM a la vez en `DiscrepanciesTable.tsx` congelaba el navegador al cambiar pestañas de filtro. Asimismo, un límite arbitrario de 10.000 registros en la API truncaba la auditoría en bases de datos con 200k+ filas.
- **Solución**: Se implementó paginación cliente de alto rendimiento (50 / 100 / 250 / 500 filas por página) con reset dinámico de página durante el renderizado, reduciendo el tiempo de pintado a < 5ms. Además, se eliminó la restricción `LIMIT 10000;` en `/api/db/records` permitiendo evaluar tablas PostGIS completas de cualquier volumen.

### Desafío 2: Correlación por Claves Únicas Compuestas por Múltiples Columnas
- **Problema**: Tablas de catastro o vialidad frecuentemente no poseen un ID secuencial único, sino claves compuestas (ej. `depto` + `padron` o `provincia` + `ruta` + `km`).
- **Solución**: Se implementó la selección interactiva de múltiples columnas SUID en [`SuidSelectorCard.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/tools/db-shapefile-sync/SuidSelectorCard.tsx). El Web Worker genera la clave hash interna combinando los valores normalizados (`val1_val2`) e instruye las sentencias `UPDATE` con cláusula `WHERE "col1" = 'v1' AND "col2" = 'v2'`.

### Desafío 3: Generación de Sentencias `INSERT` Válidas ante Restricciones `NOT NULL` de PostgreSQL
- **Problema**: Cuando el archivo fuente (SHP o CSV) contiene menos columnas que la tabla destino en PostgreSQL, la inserción de registros faltantes provocaba errores de violación de restricción `null value in column violates not-null constraint`.
- **Solución**: Se integró introspección en `/api/db/columns` consultando `information_schema.columns` (`is_nullable`, `column_default`) y se implementó el componente [`InsertDefaultsCard.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/tools/db-shapefile-sync/InsertDefaultsCard.tsx), permitiendo al usuario ingresar valores por defecto (ej. `'SISTEMA'`) o expresiones SQL (ej. `NOW()`) antes de generar los scripts.

### Desafío 4: Optimización de Búsqueda $O(1)$ frente a Búsquedas Anidadas $O(N^3)$
- **Problema**: Evaluar `Object.keys(fileRec).find(...)` dentro de un bucle anidado provocaba 1.5 millones de escaneos para 10.000 registros, congelando la interfaz.
- **Solución**: Se pre-calcula el mapa de correspondencia de columnas `fieldToFileKey` **una sola vez** antes de iniciar el bucle de comparación en la Fase 3 del Web Worker, reduciendo el costo de resolución a $O(1)$.

### Desafío 5: Serialización de Objetos `Map` a través de la Frontera `postMessage`
- **Problema**: La API `structuredClone` de los Web Workers no soporta la transferencia nativa de instancias `Map` complejas.
- **Solución**: La función `serializeFileDataset` en [`src/services/workerBridge.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/workerBridge.ts) convierte la estructura `recordsMap: Map<>` a un objeto plano `recordsObject` antes de enviar el mensaje, y el worker lo reconstruye internamente.

### Desafío 6: Hidratación Segura de `localStorage` sin Errores SSR ni Advertencias de Renderizado
- **Problema**: Leer `localStorage` en `useState(() => loadDbConfigFromLocalStorage())` causaba diferencias entre el HTML del servidor (SSR) y el cliente, provocando errores de hidratación (`Hydration failed`).
- **Solución**: Inicializar el estado de conexión con valores seguros por defecto y programar la hidratación desde `localStorage` post-montaje utilizando `queueMicrotask` dentro de `useEffect` en [`src/hooks/useDbConnectionForm.ts`](file:///c:/Alekos/Projects/gis-tools/src/hooks/useDbConnectionForm.ts).

### Desafío 7: Truncamiento de Nombres de Columna a 10 Caracteres en dBase III (DBF)
- **Problema**: El formato DBF limita los nombres de atributos a 10 caracteres.
- **Solución**: El motor evalúa coincidencias probando tanto `fieldName.toLowerCase()` como `fieldName.slice(0, 10).toLowerCase()`.

### Desafío 8: Descalces Falsos por Comillas en Cadenas de Texto (`TA014I111T9` vs `"TA014I111T9"`)
- **Problema**: Exportaciones envueltas entre comillas o con espacios no imprimibles generaban falsas discrepancias.
- **Solución**: [`src/utils/gisCleaners.ts`](file:///c:/Alekos/Projects/gis-tools/src/utils/gisCleaners.ts) limpia comillas externas (`/^["']|["']$/g`), caracteres `\xa0\r\n\t` y sufijos `.0`.

---

## 🚀 5. Posibles Mejoras y Hoja de Ruta (Roadmap)

1. **Mapa Interactivo Vectorial (Leaflet / MapLibre + Turf.js)**:
   - Visualizador de mapas en el Paso 4 para colorear entidades espaciales en verde (Coincidencias), amarillo (Discrepancia Atributos), rojo (Solo en DB) y azul (Solo en SHP).
2. **Comparación Topológica de Geometrías en Web Worker**:
   - Algoritmos de intersección espacial, diferencia de áreas y distancia Hausdorff entre geometrías PostGIS (`ST_AsGeoJSON`) y Shapefiles en el Worker.
3. **Nuevos Parseadores de Formatos (Estrategias `ISpatialFileParser`)**:
   - `KmlParser` (soporte de Google Earth `.kml` / `.kmz`).
   - `ExcelParser` (libros `.xlsx` / `.xls`).
4. **Ejecución Directa de Parches SQL (Con Confirmación)**:
   - Opción para aplicar los parches de actualización o inserción directamente sobre PostgreSQL (`BEGIN; ... COMMIT;` con `ROLLBACK`).
