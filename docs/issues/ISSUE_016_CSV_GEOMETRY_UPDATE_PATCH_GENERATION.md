# Issue #016: Generación de Sentencias SQL UPDATE para Discrepancias Geométricas en Archivos CSV y Tabulares

## 1. Problem Statement

Al realizar una sincronización entre una base de datos PostGIS y un archivo tabular CSV con columnas de latitud/longitud o geometrías espaciales:

1. **Discrepancias geométricas detectadas sin sentencias SQL en vista previa**:
   La barra de KPI indicaba correctamente la presencia de discrepancias espaciales (por ejemplo, `Discrepancias Geométricas: 19`), y la pestaña de scripts mostraba el contador `Script UPDATE • 19 sentencias`. Sin embargo, el área de texto de la vista previa SQL se mostraba completamente en blanco.
2. **Inconsistencia al ejecutar en base de datos**:
   Al abrir el modal "Confirmación de Ejecución en Base de Datos", se anunciaban 19 sentencias a ejecutar, pero al pulsar "Iniciar Ejecución por Lotes", la ejecución finalizaba con 0 sentencias ejecutadas o arrojaba el error *"No se pudieron generar las sentencias SQL para ejecutar"*.

---

## 2. Root Cause Analysis & Technical Details

### A. Condicional Restrictivo en `SqlPatchGenerator.extractGeometryUpdateClause`
En `SqlPatchGenerator.ts`, la generación de cláusulas `SET <geom_col> = ST_SetSRID(...)` estaba bloqueada por una condición que verificaba si el archivo fuente era un Shapefile binario:

```typescript
// extractGeometryUpdateClause original:
const hasGeometryMismatch =
  item.type === DiscrepancyType.GEOMETRY_MISMATCH || Boolean(item.geometryDifference);

if (!hasGeometryMismatch || !this.isBinaryDbf) {
  return null; // <- Bloqueaba CSV, GeoJSON y DB vs DB
}
```

Al sincronizar un archivo CSV, `isBinaryDbf` es `false`. Por tanto:
1. Para cada registro con `GEOMETRY_MISMATCH`, `extractGeometryUpdateClause` retornaba `null`.
2. Como las discrepancias de atributos eran 0 (`item.differences = []`), el array `setClauses` quedaba vacío (`length === 0`).
3. `collector.addUpdate(updateSql)` nunca era invocado, por lo que `collector.updatePreviewStatements` quedaba vacío (`[]`), resultando en una vista previa en blanco.
4. Sin embargo, en `SpatialComparisonEngine.ts`, `totalUpdates` se calculaba a partir de:
   ```typescript
   const totalUpdates = pass1Result.counts.attributeMismatchCount + pass1Result.counts.geometryMismatchCount;
   ```
   Dando `0 + 19 = 19`. Esto causaba que `sqlUpdateCount` fuera 19 mientras que el script generado contenía 0 sentencias.

### B. Omisión de Soporte para Inserción de Geometría en Archivos Tabulares
En `isGeometryInsertionRequested`, la verificación dependía de `if (this.isBinaryDbf) return true;`, sin considerar la bandera explícita `this.mappingConfig.compareGeometry`, omitiendo geometrías al procesar inserciones de archivos CSV que sí poseían definición espacial.

---

## 3. Implemented Solution

1. **Eliminación del Bloqueo `!this.isBinaryDbf` en Actualizaciones Geométricas**:
   Se eliminó la restricción `|| !this.isBinaryDbf` en `extractGeometryUpdateClause`. La función ahora evalúa si el ítem tiene `shpGeometry` (objeto GeoJSON generado desde el CSV) o `fileRecordIndex` (lector binario SHP). Al existir la geometría, construye la expresión PostGIS adecuada (`ST_SetSRID(ST_GeomFromGeoJSON(...))` o `ST_Transform(...)`) independientemente del formato de entrada.

2. **Reconocimiento de `compareGeometry` en Inserciones**:
   En `isGeometryInsertionRequested`, se añadió la condición `this.mappingConfig.compareGeometry || this.isBinaryDbf`, asegurando que cualquier dataset con comparación geométrica activa genere la columna y valor espacial en sentencias `INSERT INTO`.

---

## 4. Code Examples & Diff Snippets

### [SqlPatchGenerator.ts](file:///c:/Alekos/Projects/gis-tools/src/workers/comparison/SqlPatchGenerator.ts)

```diff
  private extractGeometryUpdateClause(
    item: DiscrepancyItem
  ): { column: string; valueExpr: string } | null {
    const hasGeometryMismatch =
      item.type === DiscrepancyType.GEOMETRY_MISMATCH || Boolean(item.geometryDifference);

-   if (!hasGeometryMismatch || !this.isBinaryDbf) {
+   if (!hasGeometryMismatch) {
      return null;
    }

    const geometryColumn = this.resolveGeometryColumn();
    if (!geometryColumn) {
      return null;
    }

    const rawGeometry =
      item.fileRecordIndex != null && this.shpReader
        ? this.shpReader.readGeometry(item.fileRecordIndex, null)
        : item.shpGeometry;

    if (!rawGeometry) {
      return null;
    }

    return {
      column: geometryColumn,
      valueExpr: this.sqlBuilder.buildPostgisGeomExpr(
        rawGeometry,
        geometryColumn,
        this.fileSrid
      ),
    };
  }

  private isGeometryInsertionRequested(geometryColumnName: string): boolean {
-   if (this.isBinaryDbf) return true;
+   if (this.mappingConfig.compareGeometry || this.isBinaryDbf) return true;
    return this.fieldsToCompare.includes(geometryColumnName);
  }
```

---

## 5. Verification & Testing

- **TypeScript Type Check**: `npx tsc --noEmit` completó con código `0` (0 errores).
- **ESLint**: `npm run lint` pasó limpiamente con 0 advertencias y 0 errores.
- **React Doctor**: **Score: 100 / 100 Great (`✔ No issues found!`)**.
- **Next.js Production Build**: `next build` compiló exitosamente todas las rutas en 2.0s.
