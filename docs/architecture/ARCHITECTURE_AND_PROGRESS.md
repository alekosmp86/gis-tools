# Informe de Arquitectura, Avances y Estado del Proyecto: GIS Tools

Documento integral que detalla la arquitectura del sistema, los patrones de diseño, las herramientas desarrolladas, el avance detallado por archivos, los desafíos técnicos resueltos y la hoja de ruta (roadmap).

---

## 1. Visión General del Proyecto

**GIS Tools** es una plataforma web moderna e interactiva diseñada para la auditoría, correlación, visualización espacial y sincronización alfanumérica entre **bases de datos PostgreSQL/PostGIS** y **archivos geográficos/tabulares** (`.zip` Shapefiles, `.geojson`, `.csv`).

### Principios Fundamentales:
1. **Procesamiento 100% en Cliente (In-Memory)**: Lectura y parseo de archivos directamente en el navegador del usuario. Cero almacenamiento o persistencia de datos geográficos en servidores de terceros.
2. **Modularidad Atómica**: Descomposición estricta en componentes reutilizables (`src/components/`), tipos aislados (`src/types/`), hooks de lógica (`src/hooks/`) y utilidades (`src/utils/`).
3. **Patrón Estrategia (Strategy Pattern)**: Arquitectura desacoplada mediante interfaces TypeScript (`ISpatialFileParser`, `IComparisonEngine`) para permitir incorporar nuevos formatos de archivos sin alterar el resto del sistema.
4. **Calidad y Cumplimiento Estricto (React Doctor Score: 100/100)**: Cumplimiento de optimizaciones de compilador de React (React 19 / HIR), cero render-loops redundantes, cero inline-styles (`style={{ ... }}`) y uso exclusivo de iconos Lucide SVG y Enums/Const Objects.

---

## 2. Avances Recientes y Desglose por Temas y Archivos

A continuación se detalla cada módulo implementado en la rama `feature/csv-ewkb-geometry-map`, desglosado por tema y archivo:

### A. Motor de Parseo de Geometrías PostGIS EWKB Hex y Proyección UTM 19S
- **`src/utils/ewkbParser.ts`**:
  - **Función**: Parseador binario de cadenas Hexadecimales EWKB (Extended Well-Known Binary de PostGIS, ej. `0105000020D17F0000...`).
  - **Soporte Geométrico**: Decodifica geometrías `Point`, `LineString`, `MultiLineString`, `Polygon` y `MultiPolygon`.
  - **Transformación de Coordenadas**: Incluye la función matemática de alta precisión `utm19sToWgs84(easting, northing)` que convierte coordenadas proyectadas en metros del **SRID 32719** (Uruguay UTM Zona 19S) a coordenadas geográficas en grados WGS84 $(\text{longitud}, \text{latitud})$.

### B. Auto-Detección de Columnas Espaciales en Archivos CSV
- **`src/services/parsers/CsvParser.ts`**:
  - **Función**: Analiza archivos `.csv` delimitados por coma e inspecciona la cabecera buscando columnas de geometría (`geom`, `geometry`, `wkt`, `wkb_geometry`).
  - **Integración**: Decodifica el valor EWKB Hex de cada fila y construye automáticamente la colección GeoJSON (`dataset.geojson` y `dataset.geometryType`), permitiendo visualización en mapa para archivos CSV.

### C. Constantes Globales y Mapeadores del Visor Geográfico
- **`src/constants/mapConstants.ts`**:
  - **Función**: Centraliza la configuración estática de mapas base y mapeadores de discrepancias evitando código duro en componentes UI.
  - **Mapas Base (`BASEMAP_TILES`)**:
    - 🗺️ `voyager`: CartoDB Voyager Streets (Mapa claro de calles detallado)
    - 🛣️ `osm`: OpenStreetMap Estándar
    - 🛰️ `satellite`: Esri World Imagery (Fotografía satelital)
    - 🌙 `dark`: CartoDB Dark Matter (Modo oscuro)
  - **Mapeo de Colores y Etiquetas (`DISCREPANCY_COLORS` & `DISCREPANCY_LABELS`)**:
    - 🟡 `DiscrepancyType.ATTRIBUTE_MISMATCH` $\rightarrow$ `#d97706` (Discrepancia de Atributos)
    - 🟠 `DiscrepancyType.DUPLICATE_SUID` $\rightarrow$ `#ea580c` (SUID Duplicado)
    - 🟣 `DiscrepancyType.ONLY_IN_SHP` $\rightarrow$ `#9333ea` (Solo en Archivo Fuente)
    - 🔵 `DiscrepancyType.ONLY_IN_DB` $\rightarrow$ `#0284c7` (Solo en Base de Datos)
    - 🔴 `DiscrepancyType.NULL_SUID` $\rightarrow$ `#dc2626` (SUID Nulo / Vacío)
    - 🟢 `DiscrepancyType.MATCH` $\rightarrow$ `#059669` (Coincidencia Exacta)

### D. Componente Atómico de Mapa Interactivo Leaflet
- **`src/components/shared/SpatialMapPreview.tsx`** & **`src/components/shared/SpatialMapPreview.module.css`**:
  - **Función**: Visor de mapa Leaflet modular en modo cliente (`{ ssr: false }`).
  - **Características Destacadas**:
    - **Selector de Capas**: Permite alternar en tiempo real entre los 4 mapas base (Calles, OSM, Satélite, Oscuro).
    - **Leyenda Flotante Dinámica**: Panel overlay con diseño *glassmorphism* que muestra únicamente las simbologías presentes en la capa visualizada.
    - **Popups de Atributos sin Desbordamiento**: Filtra atributos de geometría masiva (`geom` EWKB de 200+ caracteres), trunca valores extensos a 45 caracteres, aplica ajuste automático de palabras (`word-break: break-word`) e incluye un botón destacado de cierre **'X'**.
    - **Cero Inline Styles**: Estilizado mediante clases de CSS Module y selectores `data-color-type`.

### E. Custom Hook para GeoJSON de Discrepancias
- **`src/hooks/useDiscrepancyGeojson.ts`**:
  - **Función**: Hook de React que encapsula la extracción de geometrías y la vinculación de atributos de discrepancia (`_discrepancyType`, `_discrepancyNote`, `_differencesCount`) filtrados según la tarjeta KPI seleccionada por el usuario (`activeFilter`).

### F. Barra de Controles y Selector de Pestañas
- **`src/components/tools/db-shapefile-sync/ResultsControlsBar.tsx`** & **`src/components/tools/db-shapefile-sync/ResultsControlsBar.module.css`**:
  - **Función**: Sub-componente atómico para conmutar las pestañas del Paso 4 (`Tabla de Discrepancias`, `Mapa de Discrepancias Espaciales`, `Script SQL PostGIS`) y alojar el buscador de tabla.

### G. Orquestador del Paso 4 (Resultados de Análisis)
- **`src/components/tools/db-shapefile-sync/Step4ResultsView.tsx`**:
  - **Función**: Componente contenedor desacoplado que integra las tarjetas de resumen KPI, la barra de controles, la tabla de discrepancias, el mapa espacial y el generador de parches SQL.

### H. Integración en Etapas de Carga (Paso 2)
- **`src/components/tools/db-csv-sync/CsvUploader.tsx`** y **`src/components/tools/db-shapefile-sync/ShapefileUploader.tsx`**:
  - **Función**: Incorporación de `<SpatialMapPreview />` dinámico en el Paso 2 para mostrar una vista previa del mapa apenas se carga un archivo CSV con columna de geometría o un archivo Shapefile/GeoJSON.

### I. Reorganización de Componentes Compartidos en `db-sync-common`
- **`src/components/tools/db-sync-common/`**:
  - **Función**: Módulo centralizado que agrupa todas las vistas de pasos y componentes comunes entre herramientas de comparación.
  - **Componentes relocalizados**: `SuidMappingStep` (Paso 3 unificado), `SuidSelectorCard`, `AttributeFieldsCard`, `InsertDefaultsCard`, `Step4ResultsView` (Paso 4), `DiscrepanciesSummaryBar`, `DiscrepanciesTable`, `ResultsControlsBar`, `SqlPatchDrawer`, `SqlExecutionModal` y `ResyncBanner`.
  - **Aislamiento**: `db-shapefile-sync` y `db-csv-sync` mantienen únicamente sus parsers y cargadores específicos (`ShapefileUploader`, `CsvUploader`, `GeometryToggleCard`).

### J. Estrategia Combinada de Caché y Barras Skeleton de Recálculo
- **Invalidación en Vivo tras Ejecución SQL**: `SqlPatchDrawer.tsx` invoca `queryClient.invalidateQueries({ queryKey: ["datasetComparison"] })` al ejecutar exitosamente parches en PostgreSQL, re-evaluando las discrepancias en segundo plano.
- **Purga de Caché en Inicio de Sesión**: `ShapefileUploader.tsx`, `CsvUploader.tsx` y `useDbConnectionForm.ts` purgan las consultas comparativas mediante `queryClient.removeQueries(...)` al reemplazar un archivo o cambiar credenciales de DB.
- **Visualización de Recálculo con Skeletons**: `DiscrepanciesSummaryBar.tsx` muestra un cartel informativo (*"Recalculando discrepancias..."*) y conmuta los valores de las tarjetas KPI a barras animadas de Skeleton (`styles.skeletonValue`) durante el procesamiento asíncrono.

### L. Refactorización del Orquestador de Wizard y Límites de Tipos
- **`src/components/shared/WizardOrchestrator.tsx` & `.module.css`**:
  - Componente orquestador desacoplado que asume la responsabilidad exclusiva de renderizar la tarjeta master glassmorphism, el indicador de pasos, el Pill de estado (`Paso N de M`), los títulos y la barra inferior de navegación (`Volver` / `Continuar`).
  - **Componentes de Pasos Agnósticos**: Se eliminaron los botones de navegación y encabezados rígidos de los formularios interiores (`DbConnectionForm`, `CsvUploader`, `ShapefileUploader`, `SuidMappingStep`, `Step4ResultsView`). Los pasos exponen métodos imperativos `proceed()` vía `React.forwardRef`.
  - **Aislamiento de Estado por Paso (`key`)**: Asignación de llaves `key="db1-form"` y `key="db2-form"` en la herramienta de sincronización DB vs. DB, más la llave dinámica `<div key={`step-content-${activeStep.id}`}>` en el orquestador, garantizando el desmontaje y limpieza total de estado al avanzar entre pasos.
  - **Desplazamiento Suave Automático (`smoothScroll`)**: `useEffect` con `scrollIntoView({ behavior: "smooth", block: "start" })` que posiciona automáticamente la vista en la parte superior del wizard en cada transición de paso.
- **Reorganización Estricta de Tipos**:
  - **`src/types/ui.ts`**: Centraliza todos los tipos de interfaz de usuario (`WizardStepDef`, `WizardOrchestratorProps`, `ToolCategory`, `ToolCardData`, `ToolCardProps`, `StepIndicatorProps`, etc.).
  - **`src/types/comparison.ts`**: Centraliza modelos de discrepancias y tipos de correspondencia/mapeo (`ColumnMappingConfig`, `InsertFieldDefault`, `SuidMappingStepProps`, `SuidMappingStepRef`).
  - **`src/types/gis.ts`**: Enfocado en tipos de dominio espacial (`CommonSrid`), re-exportando los módulos anteriores para compatibilidad.

---

## 3. Desafíos Técnicos Resueltos

1. **Sincronización Estricta entre Tarjetas KPI y Registros en Tabla**:
   - Se corrigieron los contadores en `comparisonWorker.ts` y `comparisonWorkerSync.ts` para que los contadores de la barra KPI coincidan 100% con los ítems filtrados en la tabla.

2. **Evitar Generación de Parches SQL Inconsistentes en Registros Duplicados**:
   - Se restringió la emisión de sentencias `UPDATE` en el script SQL PostGIS únicamente a registros sin duplicación de SUID (`!isDuplicate`), garantizando que cuando `Discrepancias de Atributos = 0`, el script SQL de actualización sea completamente limpio.

3. **Compatibilidad con React Compiler y SSR de Leaflet**:
   - Se eliminaron estructuras `finally` en funciones asíncronas de carga.
   - Se migró el componente de mapa a importación dinámica `{ ssr: false }` para evitar errores de hidratación en Next.js.
   - Puntuación en **React Doctor**: **100 / 100 Great (`✔ No issues found!`)**.

---

## 4. Estado Actual de la Plataforma

Actualmente **GIS Tools** cuenta con dos herramientas completamente funcionales de punta a punta:

1. **Herramienta 1: DB vs. Shapefile / GeoJSON (`/tools/db-shapefile-sync`)**:
   - Conexión e inspección de esquema PostGIS.
   - Parseo de archivos `.zip` (SHP+DBF) y `.geojson`.
   - Mapeo interactivo de clave SUID (simple o compuesta) y selección de atributos.
   - Análisis comparativo alfanumérico.
   - Visualización espacial en mapa interactivo con mapa de calles y filtros por tipo de discrepancia.
   - Generación de scripts SQL de parche PostGIS (`UPDATE` e `INSERT`).

2. **Herramienta 2: DB vs. CSV (`/tools/db-csv-sync`)**:
   - Conexión e inspección de esquema PostGIS.
   - Parseo de archivos `.csv` con soporte de geometrías EWKB Hex PostGIS (SRID 32719).
   - Mapeo de clave SUID y atributos.
   - Análisis comparativo alfanumérico.
   - Visor de mapa espacial interactivo para geometrías detectadas en CSV.
   - Generación de scripts SQL de parche PostGIS.

---

## 5. Próximos Pasos y Hoja de Ruta (Roadmap)

1. **Visualización de Geometrías de la Base de Datos (PostGIS `ST_AsGeoJSON`)**:
   - Consultar la geometría PostGIS desde la BD para superponer simultáneamente en el mapa la entidad de la base de datos (ej. en color azul) frente a la entidad del archivo (ej. en color amarillo/púrpura) para comparar descalces geométricos.

2. **Comparación Topológica de Geometrías en Cliente**:
   - Implementar cálculo de intersección espacial, diferencia de áreas y distancia Hausdorff entre geometrías PostGIS y del archivo fuente.

3. **Nuevos Parseadores de Formatos (Estrategias)**:
   - `KmlParser`: Soporte para archivos `.kml` / `.kmz` de Google Earth.
   - `ExcelParser`: Soporte para planillas `.xlsx` / `.xls`.

4. **Ejecución Directa de Parches SQL (Transaccional)**:
   - Permitir aplicar las sentencias SQL directamente en la base de datos PostgreSQL conectada con soporte de `BEGIN; ... COMMIT;` y `ROLLBACK`.
