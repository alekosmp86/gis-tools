# Arquitectura, Desafíos Técnicos y Estado del Proyecto: GIS Tools

Este documento reúne la arquitectura general, decisiones de diseño, patrones aplicados, desafíos técnicos resueltos y la hoja de ruta de desarrollo de la plataforma **GIS Tools**.

---

## 📋 1. Visión General del Proyecto

**GIS Tools** es un portal web modular diseñado para la auditoría, correlación y sincronización de información alfanumérica y espacial entre **bases de datos PostgreSQL/PostGIS** y **fuentes de datos externas** (archivos Shapefile `.zip`, `.geojson` y archivos alfanuméricos `.csv`).

### Principios de Diseño
1. **Procesamiento 100% en Memoria del Navegador**: Ningún archivo cargado (.zip, .shp, .csv) se almacena en disco de servidores o tablas temporales de base de datos. Toda la inspección ocurre en memoria RAM local del usuario.
2. **Componentes Atómicos y Reglas Estrictas**: Separación clara entre interfaces UI, hooks de lógica, tipos TypeScript y servicios de dominio.
3. **Escalabilidad mediante Patrones de Diseño**: Uso del **Patrón Estrategia (Strategy Pattern)** para añadir nuevos formatos de archivos o motores de comparación sin alterar componentes existentes.

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
   - **`DbVsFileComparisonEngine`** ([`src/services/engines/DbVsFileComparisonEngine.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/engines/DbVsFileComparisonEngine.ts)): Motor universal que correlaciona registros PostGIS contra cualquier dataset `ParsedFileDataset`, clasifica discrepancias y genera parches SQL de actualización.

### B. Organización Modular de Componentes
- **`src/components/shared/`**: Componentes reutilizables por múltiples herramientas:
  - `DbConnectionForm.tsx` (Paso 1: Conexión a PostgreSQL e Inspección de Esquema)
  - `StepIndicator.tsx` (Indicador de pasos horizontal del Wizard)
  - `ColumnsList.tsx` (Lista de etiquetas de columnas/atributos)
  - `AlertMessage.tsx` (Notificaciones y alertas de estado)
- **`src/components/tools/db-shapefile-sync/`**: Componentes del wizard específicos para Shapefiles.
- **`src/components/tools/db-csv-sync/`**: Componentes del wizard específicos para archivos CSV.
- **`src/components/ui/`**: Primitivas UI atómicas (`Button`, `Badge`, `FormField`, `SearchInput`).

### C. Cero Comparaciones contra Literales de Texto (Enums & Const Objects)
Todos los estados, categorías y filtros están tipados mediante objetos constantes/enums en `src/types/`:
- `DiscrepancyType` (`MATCH`, `ATTRIBUTE_MISMATCH`, `ONLY_IN_DB`, `ONLY_IN_SHP`)
- `DiscrepancyFilter` (`ALL`, `MATCH`, `ATTRIBUTE_MISMATCH`, `ONLY_IN_DB`, `ONLY_IN_SHP`)
- `ResultsViewTab` (`TABLE`, `SQL`)
- `BadgeVariant`, `ButtonVariant`, `ToolCategory`

### D. Persistencia Segura (`localStorageDbConfig.ts`)
- Utiliza la clave versionada `gis_tools_db_config_v1` para guardar en `localStorage` la configuración de conexión (servidor, puerto, usuario, base de datos, esquema y tabla).
- **Seguridad**: Excluye automáticamente la contraseña de la persistencia local.

---

## ⚡ 3. Desafíos Técnicos y Soluciones Aplicadas

### Desafío 1: Truncamiento de Nombres de Columna a 10 Caracteres en dBase III (DBF)
- **Problema**: El formato DBF limita los nombres de atributos a 10 caracteres (ej. `padron_id` en DBF se exporta como `padron_id` o `padron_i`).
- **Solución**: Tanto para la clave SUID como para los atributos a comparar, el sistema busca coincidencias evaluando tanto `fieldName.toLowerCase()` como `fieldName.slice(0, 10).toLowerCase()`.

### Desafío 2: Descalces Falsos por Comillas en Cadenas de Texto (`TA014I111T9` vs `"TA014I111T9"`)
- **Problema**: Exportaciones de texto o DBF envolvían cadenas entre comillas dobles, provocando que `'TA014I111T9'` y `'"TA014I111T9"'` se clasificaran erróneamente como discrepancia de atributos.
- **Solución**: Se implementó el módulo de limpieza [`src/utils/gisCleaners.ts`](file:///c:/Alekos/Projects/gis-tools/src/utils/gisCleaners.ts) con la función `cleanValue`:
  - Elimina comillas externas (`/^["']|["']$/g`).
  - Elimina espacios de no separación (`\xa0`), tabulaciones y saltos de línea (`\r\n\t`).
  - Remueve el sufijo `.0` generado al convertir números flotantes a texto.

### Desafío 3: Reglas de Rendimiento y Cumplimiento de React Doctor
- **Problema**: Scans $O(N)$ dentro de loops `.map()` y llamadas asíncronas de `setState` dentro de `useEffect`.
- **Solución**:
  - Creación del hook de React Query [`useComparisonQuery.ts`](file:///c:/Alekos/Projects/gis-tools/src/hooks/useComparisonQuery.ts) para manejar la ejecución asíncrona del motor con caché cliente.
  - Indexación previa de arreglos en `Map` y `Set` de búsqueda $O(1)$.

---

## 🛠️ 4. Herramientas Actuales en el Portal

1. **Sincronización DB vs. Shapefile** ([`/tools/db-shapefile-sync`](file:///c:/Alekos/Projects/gis-tools/src/app/tools/db-shapefile-sync/page.tsx)):
   - Soporta archivos `.zip` (SHP+DBF) y `.geojson`.
   - Comparación de atributos alfanuméricos y conmutador de topología geométrica.

2. **Sincronización DB vs. CSV** ([`/tools/db-csv-sync`](file:///c:/Alekos/Projects/gis-tools/src/app/tools/db-csv-sync/page.tsx)):
   - Soporta archivos `.csv` delimitados por coma.
   - Comparación de atributos alfanuméricos y generación de scripts SQL PostGIS.

---

## 🚀 5. Posibles Mejoras y Hoja de Ruta (Roadmap)

1. **Mapa Interactivo Vectorial (Leaflet / MapLibre + Turf.js)**:
   - Visualizador de mapas en el Paso 4 para colorear entidades espaciales en verde (Coincidencias), amarillo (Discrepancia Atributos), rojo (Solo en DB) y azul (Solo en SHP).
2. **Comparación Topológica de Geometrías en JS/Wasm**:
   - Algoritmos de intersección espacial, diferencia de áreas y distancia Hausdorff entre geometrías PostGIS (`ST_AsGeoJSON`) y Shapefiles.
3. **Nuevos Parseadores de Formatos (Estrategias)**:
   - `KmlParser` (soporte de Google Earth `.kml` / `.kmz`).
   - `ExcelParser` (libros `.xlsx` / `.xls`).
4. **Ejecución Directa de Parches SQL (Con Confirmación)**:
   - Opción para aplicar el parche de actualización generado directamente sobre PostgreSQL (`BEGIN; ... COMMIT;` con `ROLLBACK`).
