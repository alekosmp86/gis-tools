# Issue #012: Generación de Sentencias SQL UPDATE Unificadas por SUID y Prevención de Actualizaciones Nulas

## 1. Problem Statement

Al ejecutar la sincronización de una tabla espacial PostGIS (`ide_ejesviacirculacion`) contra un archivo CSV, se observaron dos anomalías críticas en el generador de parches SQL:

1. **Múltiples consultas UPDATE por SUID**: El motor generaba sentencias `UPDATE` individuales e independientes por cada columna para el mismo registro / clave SUID (`reftramo = '917800' AND idcalle = '38980'`), en lugar de una única sentencia `UPDATE` consolidada con todas las columnas modificadas.
2. **Columnas actualizadas a `NULL` erróneamente**: Se generaban sentencias `SET "col" = NULL` para todas las columnas de la tabla:
   ```sql
   UPDATE "gis_tools"."ide_ejesviacirculacion" SET "geom_wkb" = NULL WHERE "reftramo" = '917800' AND "idcalle" = '38980';
   UPDATE "gis_tools"."ide_ejesviacirculacion" SET "nombre" = NULL WHERE "reftramo" = '917800' AND "idcalle" = '38980';
   UPDATE "gis_tools"."ide_ejesviacirculacion" SET "tipo_vialidad" = NULL WHERE "reftramo" = '917800' AND "idcalle" = '38980';
   UPDATE "gis_tools"."ide_ejesviacirculacion" SET "fuente" = NULL WHERE "reftramo" = '917800' AND "idcalle" = '38980';
   UPDATE "gis_tools"."ide_ejesviacirculacion" SET "localidad" = NULL WHERE "reftramo" = '917800' AND "idcalle" = '38980';
   UPDATE "gis_tools"."ide_ejesviacirculacion" SET "departamento" = NULL WHERE "reftramo" = '917800' AND "idcalle" = '38980';
   ```
   a pesar de que los registros ya existían en la base de datos con valores válidos.

---

## 2. Root Cause Analysis & Technical Details

### A. Ausencia de Filtro por Tipo de Discrepancia en `SqlPatchGenerator.ts`
- El método `processItemUpdates(item, collector)` procesaba **cualquier** ítem que contuviera `dbRecord`, sin validar `item.type`.
- Para los registros catalogados como `DiscrepancyType.ONLY_IN_DB` (registros presentes en la base de datos pero ausentes en el archivo fuente), el extractor generaba diferencias donde `shpValue: null`.
- En consecuencia, el generador emitía sentencias `UPDATE table SET campo = NULL WHERE suid`, mutando destructivamente filas que simplemente no venían en el archivo. En sincronización espacial, los registros `ONLY_IN_DB` nunca deben generar sentencias `UPDATE`.

### B. Emisión Atómica por Campo en Lugar de por Registro / SUID
- `SqlPatchGenerator` iteraba por cada elemento de `item.differences` y llamaba individualmente a `this.sqlBuilder.buildUpdateStatement(diff.fieldName, diff.shpValue, whereClause)`, y luego llamaba por separado a `this.buildGeometryUpdate(...)`.
- Esto causaba que un registro con $N$ diferencias generara $N$ sentencias `UPDATE` con idéntica condición `WHERE`.

### C. Vulnerabilidades en `CsvParser.ts` y Comparación de SUID
- Archivos CSV exportados desde Excel o herramientas en español suelen contener una marca de orden de bytes UTF-8 BOM (`\uFEFF`) al inicio del archivo. `CsvParser` no eliminaba este BOM, por lo que el primer encabezado quedaba como `"\uFEFFreftramo"`, provocando que `record["reftramo"]` fuera `undefined` y el SUID no coincidiera, marcando erróneamente todos los registros como `ONLY_IN_DB`.
- Delimitadores alternativos (como punto y coma `;` o tabulación `\t`) no eran detectados automáticamente.
- La resolución de SUID (`SuidKeyResolver.ts`) y la extracción de atributos (`FeatureAttributeExtractor.ts`) realizaban búsquedas estrictas sensibles a mayúsculas/minúsculas sin mecanismo fallback.

---

## 3. Implemented Solution

1. **Sentencia UPDATE Compuesta por SUID**:
   - En [`SqlScriptBuilder.ts`](src/workers/comparison/SqlScriptBuilder.ts), se implementó `buildCompositeUpdateStatement(setClauses, whereClause)`, construyendo `UPDATE "schema"."table" SET "col1" = val1, "col2" = val2 WHERE suid;`.
   - Se eliminaron los métodos obsoletos `buildUpdateStatement` y `buildUpdateStatementRaw` para evitar código muerto.

2. **Filtro Estricto en `processItemUpdates`**:
   - En [`SqlPatchGenerator.ts`](src/workers/comparison/SqlPatchGenerator.ts), se incorporó una guardia estricta:
     ```typescript
     if (
       item.type !== DiscrepancyType.ATTRIBUTE_MISMATCH &&
       item.type !== DiscrepancyType.GEOMETRY_MISMATCH
     ) {
       return;
     }
     ```
   - Los ítems `ONLY_IN_DB`, `ONLY_IN_SHP`, `DUPLICATE_SUID` y `NULL_SUID` quedan excluidos de la generación de actualizaciones.
   - Todas las diferencias de atributos y la actualización geométrica se agrupan en un único array `setClauses`, emitiendo exactamente una consulta `UPDATE` por SUID.

3. **Parser CSV Robusto con Detección de Delimitador y Remoción de BOM**:
   - En [`CsvParser.ts`](src/services/parsers/CsvParser.ts), se remueve el BOM UTF-8 inicial (`rawText.replace(/^\uFEFF/, "")`).
   - Se añadió `detectDelimiter()` para soportar comas `,`, punto y coma `;` y tabulaciones `\t`.
   - Se incluyó `geom_wkb` en las expresiones regulares de detección geométrica.

4. **Búsqueda Fallback Insensible a Mayúsculas/Minúsculas**:
   - En [`SuidKeyResolver.ts`](src/workers/comparison/SuidKeyResolver.ts) y [`FeatureAttributeExtractor.ts`](src/workers/comparison/FeatureAttributeExtractor.ts), si el atributo no se encuentra por nombre exacto, se realiza una búsqueda insensible a mayúsculas/minúsculas en el objeto de registro.

---

## 4. Code Examples & Diff Snippets

### A. Consolidación de UPDATE en `SqlPatchGenerator.ts`:

```typescript
// Antes:
for (let differenceIndex = 0; differenceIndex < item.differences.length; differenceIndex++) {
  const difference = item.differences[differenceIndex];
  const updateSql = this.sqlBuilder.buildUpdateStatement(difference.fieldName, difference.shpValue, whereClause);
  collector.addUpdate(updateSql);
}
// Y luego otra sentencia separada para geometría...

// Ahora:
const setClauses: Array<{ column: string; valueExpr: string }> = [];
for (let differenceIndex = 0; differenceIndex < item.differences.length; differenceIndex++) {
  const difference = item.differences[differenceIndex];
  setClauses.push({
    column: difference.fieldName,
    valueExpr: this.sqlBuilder.formatSqlValue(difference.shpValue, difference.fieldName),
  });
}
if (hasGeometryMismatch && this.isBinaryDbf) {
  // añade geomExpr al mismo setClauses...
}
if (setClauses.length > 0) {
  const updateSql = this.sqlBuilder.buildCompositeUpdateStatement(setClauses, whereClause);
  collector.addUpdate(updateSql);
}
```

### B. Resultado Generado:

```sql
UPDATE "gis_tools"."ide_ejesviacirculacion" 
SET "geom_wkb" = '0105...', "nombre" = 'WILSON FERREIRA ALDUNATE', "tipo_vialidad" = 'CALLE' 
WHERE "reftramo" = '917800' AND "idcalle" = '38980';
```

---

## 5. Verification & Testing

- **TypeScript Compilation**: `npx tsc --noEmit` completó con código de salida `0` (0 errores).
- **ESLint**: `npm run lint` pasó limpiamente con 0 errores y 0 advertencias.
- **React Doctor**: `npx react-doctor@latest --verbose` reportó **Score: 100 / 100 Great** con 0 problemas.
- **Limpieza de Código Muerto**: Se eliminaron métodos redundantes de actualización simple en `SqlScriptBuilder.ts`.
