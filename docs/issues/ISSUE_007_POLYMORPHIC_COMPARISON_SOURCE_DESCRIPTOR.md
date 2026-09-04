# Issue #007: Arquitectura Polimórfica de Descriptores de Fuentes de Comparación

## 1. Problem Statement
En la sincronización entre bases de datos PostgreSQL/PostGIS (DB vs. DB), las tarjetas de resumen KPI y la tabla de resultados mostraban etiquetas fijas orientadas a archivos ("Solo en Base de Datos", "Solo en Archivo Fuente", "Valores dispares entre DB y SHP"). Esto generaba confusión semántica al comparar réplicas donde ambas fuentes son bases de datos. Además, la lógica de presentación dependía de verificaciones condicionales dispersas (`isDbToDb ? ... : ...`), violando el Principio de Abierto/Cerrado (OCP) y dificultando la incorporación futura de nuevas fuentes de datos (GeoPackage, GeoJSON, APIs WFS, Spatialite, etc.).

## 2. Root Cause Analysis & Technical Details
- Los componentes de visualización (`DiscrepanciesSummaryBar.tsx`, `DiscrepanciesTable.tsx`, `Step4ResultsView.tsx`) asumían implícitamente que la fuente de referencia era siempre un archivo (`.shp` o `.csv`), utilizando textos duros y comprobaciones booleanas ad-hoc.
- No existía un contrato de datos polimórfico que describiera los nombres, etiquetas cortas e íconos de las fuentes origen y destino involucradas en la comparación.

## 3. Implemented Solution
1. **Contrato de Datos `ComparisonSourceDescriptor`**:
   - Definido en [`src/types/comparison.ts`](src/types/comparison.ts) para modelar `targetLabel`, `targetShortLabel`, `targetIconKind`, `sourceLabel`, `sourceShortLabel` y `sourceIconKind`.
2. **Catálogo de Descriptores y Resolver**:
   - Creado [`src/constants/comparisonDescriptors.ts`](src/constants/comparisonDescriptors.ts) con presets (`DB_VS_SHAPEFILE_DESCRIPTOR`, `DB_VS_CSV_DESCRIPTOR`, `DB_VS_DB_DESCRIPTOR`, `resolveComparisonDescriptor`).
3. **Componente Estático `ComparisonIcon`**:
   - Creado [`src/components/ui/ComparisonIcon.tsx`](src/components/ui/ComparisonIcon.tsx) para renderizar íconos según el tipo de fuente sin recrear componentes en tiempo de render.
4. **Componentes Agnósticos y Puros**:
   - [`DiscrepanciesSummaryBar.tsx`](src/components/tools/db-sync-common/DiscrepanciesSummaryBar.tsx) y [`DiscrepanciesTable.tsx`](src/components/tools/db-sync-common/DiscrepanciesTable.tsx) ahora consumen directamente el descriptor sin ninguna comprobación condicional interna.
5. **Inyección en Páginas de Herramientas**:
   - Cada página de sincronización (`db-shapefile-sync`, `db-csv-sync`, `db-db-sync`) inyecta su descriptor explícito a `Step4ResultsView`.

## 4. Code Examples & Diff Snippets

### Antes (Lógica Acoplada con Flags Booleanos)
```tsx
const onlyInDbTitle = isDbToDb ? "Solo en DB Destino" : "Solo en Base de Datos";
const onlyInSourceTitle = isDbToDb ? "Solo en DB Origen" : "Solo en Archivo Fuente";
```

### Después (Componente Agnóstico Basado en Descriptores)
```tsx
<SummaryKpiCard
  title={`Solo en ${descriptor.targetLabel}`}
  subtitle={`Faltantes en ${descriptor.sourceLabel}`}
  icon={Database}
/>
<SummaryKpiCard
  title={`Solo en ${descriptor.sourceLabel}`}
  subtitle={`Faltantes en ${descriptor.targetLabel}`}
  icon={sourceIcon}
/>
```

## 5. Verification & Testing
- **TypeScript & Linting**: `npx tsc --noEmit` y `npm run lint` ejecutados con 0 errores.
- **React Doctor Audit**: `npx react-doctor@latest --verbose` ejecutado con puntuación perfecta **100 / 100 Great** (`0 issues`).
- **Validación Visual**:
  - `DB vs. Shapefile`: Etiquetas "Base de Datos" y "Archivo Shapefile".
  - `DB vs. CSV`: Etiquetas "Base de Datos" y "Archivo CSV".
  - `DB vs. DB`: Etiquetas "DB Destino" y "DB Origen" con íconos de base de datos en ambas columnas.
