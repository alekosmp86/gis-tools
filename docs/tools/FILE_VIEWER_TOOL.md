# Visor de Archivos Espaciales — Documentación de la Herramienta

> **Ubicación**: `src/components/tools/file-viewer/`  
> **Ruta**: `/tools/file-viewer`  
> **Fecha**: 2026-08-26  
> **Estado**: Implementado & Operativo

---

## 1. Visión General

El **Visor de Archivos Espaciales** es una herramienta de vista única (sin asistente de múltiples pasos) que permite cargar archivos vectoriales o alfanuméricos y visualizar de forma instantánea:
1. Las **entidades geográficas** en un mapa interactivo de Leaflet.
2. Los **metadatos** del archivo (tamaño, tipo de geometría, conteo de registros, columnas).
3. La **tabla de atributos** completa con paginación y filtro de búsqueda por texto.

---

## 2. Archivos del Módulo (`src/components/tools/file-viewer/`)

Todos los componentes específicos de esta herramienta residen aislados en su propia carpeta:

- **`FileViewerContainer.tsx` + `.module.css`**: Componente contenedor principal que coordina el cargador, el visor de mapa, el panel de metadatos y la tabla de atributos. Carga de forma dinámica `SpatialMapPreview` con `{ ssr: false }` para evitar evaluaciones de Leaflet en el servidor Next.js.
- **`FileViewerUploader.tsx` + `.module.css`**: Zona de carga por arrastrar y soltar (drag & drop) o selector de archivos. Soporta `.zip` (Shapefile), `.geojson`, `.json`, `.csv`, `.txt`.
- **`FileMetaPanel.tsx` + `.module.css`**: Panel de resumen de metadatos y tarjetas estáticas.
- **`AttributeTable.tsx` + `.module.css`**: Tabla interactiva paginada con filtro de búsqueda global en atributos.

---

## 3. Características Técnicas & Parsers Extendidos

- **Soporte WKT & WKB**: Parser dedicado `src/utils/wktParser.ts` capaz de procesar cadenas `POINT`, `LINESTRING`, `POLYGON` y `MULTIPOLYGON`.
- **Auto-detección de Latitud/Longitud**: `CsvParser` detecta automáticamente pares de columnas numéricas (como `lat`/`lng`, `latitude`/`longitude`, `y`/`x`) para generar puntos GeoJSON si no existe geometría explicita.
- **Ciclo de Vida SSR & Carga de Nodo Leaflet**:
  - `SpatialMapPreview` utiliza un *callback ref* (`setMapContainerNode`) en lugar de `useRef` para garantizar que `useLeafletMap` reaccione exactamente cuando el elemento DOM del mapa entra en la vista.
  - La sincronización del basemap tile layer está desvinculada de la importación de entidades para evitar re-lecturas de geometrías al cambiar el proveedor de mapa base.

---

## 4. Reutilización de Componentes y Servicios Existentes

La herramienta fue construida reutilizando la infraestructura core del proyecto:

| Componente / Servicio | Origen | Función Reutilizada |
|---|---|---|
| `ShapefileParser` | `src/services/parsers/ShapefileParser.ts` | Descompresión y parseo de `.zip`, `.geojson`, `.json` |
| `CsvParser` | `src/services/parsers/CsvParser.ts` | Lectura de `.csv`, extracción de geometrías EWKB/WKT y Lat/Lng |
| `SpatialMapPreview` | `src/components/shared/SpatialMapPreview.tsx` | Visor de mapa Leaflet con Canvas Renderer (`L.canvas`) |
| `PaginationControls` | `src/components/shared/PaginationControls.tsx` | Paginación de la tabla de atributos |
| `AlertMessage` | `src/components/shared/AlertMessage.tsx` | Mensajes de alerta y manejo de errores |
| `Button` | `src/components/ui/Button.tsx` | Botones de interfaz |

---

## 5. Registro en el Menú Principal (`toolsData.ts`)

Se actualizó `src/data/toolsData.ts` para registrar el nuevo visor bajo la categoría `ToolCategory.VIEWERS` ("Visualización") y se eliminaron de la grilla principal los accesos directos a herramientas no implementadas o planificadas a futuro.
