# 🌍 GIS Tools — Plataforma de Auditoría y Sincronización SIG

**GIS Tools** es una plataforma web modular de alta velocidad diseñada para la auditoría, correlación, análisis de discrepancias, visualización espacial y sincronización de datos alfanuméricos y geográficos entre **bases de datos PostgreSQL/PostGIS** y **fuentes de datos externas** (Shapefiles `.zip`, GeoJSON `.geojson` y archivos alfanuméricos `.csv`).

---

## 🚀 Herramientas Disponibles

1. **Sincronización DB vs. Shapefile** (`/tools/db-shapefile-sync`)
   - Correlación de tablas PostgreSQL/PostGIS contra archivos Shapefile (`.zip`) y GeoJSON (`.geojson`).
   - Mapeo de clave SUID (simple o compuesta por múltiples columnas).
   - Generación de scripts SQL PostGIS de actualización (`UPDATE`) e inserción (`INSERT`).

2. **Sincronización DB vs. CSV** (`/tools/db-csv-sync`)
   - Correlación de tablas PostGIS contra archivos `.csv` alfanuméricos y espaciales.
   - Decodificación automática de geometrías EWKB Hex y pares Latitud/Longitud.
   - Generación de parches SQL para PostGIS.

3. **Visor de Archivos Espaciales** (`/tools/file-viewer`)
   - Inspección directa e instantánea de archivos Shapefile, GeoJSON y CSV.
   - Mapa interactivo Leaflet con selección bidireccional mapa-tabla de atributos.

---

## 🛠️ Tecnologías Principales

- **Framework**: Next.js 16 (App Router, Turbopack) & React 19
- **Estilos**: Vanilla CSS Modules (Glassmorphism, Cero inline styles)
- **Mapas**: Leaflet (Canvas Renderer `L.canvas` para 60fps)
- **Procesamiento**: Web Workers (Multihilo en memoria local $O(1)$)
- **Caché y Estado**: TanStack React Query v5
- **Iconografía**: Lucide React Icons exclusivamente

---

## 📁 Estructura del Proyecto

```
src/
├── app/                     # Rutas y Next.js API Routes (/api/db/...)
├── components/
│   ├── layout/              # Header, Footer, Hero
│   ├── shared/              # DbConnectionForm, ProfileSelect, StepIndicator
│   ├── ui/                  # Button, Badge, SearchInput
│   └── tools/
│       ├── db-sync-common/  # Módulo compartido de pasos (Step 3 & Step 4)
│       ├── db-shapefile-sync/# Componentes exclusivos de Shapefile
│       ├── db-csv-sync/     # Componentes exclusivos de CSV
│       └── file-viewer/     # Visor de archivos espaciales
├── constants/               # Configuración estática de mapas y colores
├── data/                    # Catálogo de herramientas y perfiles
├── hooks/                   # Custom Hooks (useDbConnectionForm, etc.)
├── services/                # Parsers (ShapefileParser, CsvParser) y Motores
├── types/                   # Modelos TypeScript aislados
├── utils/                   # Parseadores EWKB/WKT y limpiadores
└── workers/                 # Web Workers de procesamiento asíncrono
```

---

## 📚 Documentación

Toda la documentación detallada del proyecto se encuentra organizada en el directorio [`docs/`](file:///c:/Alekos/Projects/gis-tools/docs/README.md):

- 🏗️ [**Arquitectura General & Componentes**](file:///c:/Alekos/Projects/gis-tools/docs/architecture/ARCHITECTURE.md)
- 📊 [**Informe de Avances & Desafíos Resueltos**](file:///c:/Alekos/Projects/gis-tools/docs/architecture/ARCHITECTURE_AND_PROGRESS.md)
- 💾 [**Ejecución Directa de SQL en PostGIS**](file:///c:/Alekos/Projects/gis-tools/docs/database/POSTGIS_DIRECT_SQL_EXECUTION.md)
- 🗺️ [**Visor de Archivos Espaciales**](file:///c:/Alekos/Projects/gis-tools/docs/tools/FILE_VIEWER_TOOL.md)
- 🎨 [**Estándares de Código y Reglas UI**](file:///c:/Alekos/Projects/gis-tools/docs/architecture/CODEBASE_STANDARDS_AND_UI_GUARDS.md)

---

## ⚙️ Desarrollo Local

```bash
# Iniciar servidor de desarrollo
npm run dev

# Ejecutar auditoría React Doctor
npm run doctor

# Validar ESLint
npm run lint

# Construcción de producción
npm run build
```
