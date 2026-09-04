# Issue #014: Optimización de Sentencias UPDATE en PostGIS mediante Búsqueda por Clave Primaria (PK)

## 1. Problem Statement

Al ejecutar procesos de sincronización entre capas espaciales (Shapefiles, CSV o réplicas de bases de datos) y tablas PostgreSQL/PostGIS de gran escala (1.000.000+ registros) utilizando claves SUID compuestas (ej. `departamento` + `padron` + `numcarcat`), las sentencias SQL de actualización generadas producían condiciones `WHERE` multi-columna:

```sql
UPDATE "public"."padrones"
SET "area" = 452.18, "geom" = ST_SetSRID(...)
WHERE "coddepto" = '05' AND "codloccat" = '020' AND "padron" = '12345' AND "numcarcat" = '0';
```

En tablas con más de 1M de filas, si no existe un índice compuesto explícito en esas columnas exactas (o si el orden de las columnas no coincide), PostgreSQL se ve forzado a realizar un **escaneo secuencial (Seq Scan)** de 1.000.000 de filas por cada sentencia `UPDATE`. Si el parche contiene 10.000 actualizaciones, esto representa $10.000 \times 1.000.000 = 10\text{ mil millones}$ de evaluaciones de tuplas, congelando la base de datos por saturación de CPU e I/O de disco.

---

## 2. Root Cause Analysis & Technical Details

### A. Cláusula WHERE Atada Exclusivamente a Columnas SUID
El generador de parches ([`SqlPatchGenerator.ts`](file:///c:/Alekos/Projects/gis-tools/src/workers/comparison/SqlPatchGenerator.ts)) construía la cláusula `WHERE` mapeando directamente las columnas de negocio seleccionadas como SUID (`dbSuidCols`):

```typescript
private buildWhereClause(dbRecord: Record<string, unknown>): string {
  const conditions = this.dbSuidCols.map((col) =>
    this.sqlBuilder.formatWhereCondition(col, dbRecord[col])
  );
  return conditions.join(" AND ");
}
```

### B. Falta de Introspección de la Clave Primaria en PostgreSQL
Aunque la base de datos contara con una clave primaria sustituta (como `id bigint PRIMARY KEY`, `gid`, u `ogc_fid`) con su respectivo índice B-Tree compacto de acceso $O(1)$, dicha columna no se detectaba en [`/api/db/columns`](file:///c:/Alekos/Projects/gis-tools/src/app/api/db/columns/route.ts) ni se incluía en las consultas de streaming de registros ([`/api/db/records/stream`](file:///c:/Alekos/Projects/gis-tools/src/app/api/db/records/stream/route.ts)).

---

## 3. Implemented Solution

Se implementó una arquitectura adaptativa de **Optimización de Búsqueda por Clave Primaria**:

1. **Introspección Automática de PK en Catálogo PostgreSQL**:
   En [`src/app/api/db/columns/route.ts`](file:///c:/Alekos/Projects/gis-tools/src/app/api/db/columns/route.ts), se consulta `pg_index` unido a `pg_attribute` donde `indisprimary = true`. Si la tabla posee una clave primaria de columna única, se extrae y etiqueta en `columnDetails` como `is_primary_key: true` y se devuelve `primaryKeyColumn` en el payload JSON.

2. **Inclusión Selectiva en Streaming de Registros**:
   Tanto en [`DatabaseStreamReader.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/streaming/DatabaseStreamReader.ts) como en los endpoints [`/api/db/records`](file:///c:/Alekos/Projects/gis-tools/src/app/api/db/records/route.ts) y [`/api/db/records/stream`](file:///c:/Alekos/Projects/gis-tools/src/app/api/db/records/stream/route.ts), se incluye la columna de clave primaria dentro de `allSelectedCols`, asegurando que cada registro en memoria contenga su identificador único de tabla.

3. **Componente Atómico `PkOptimizationCard` en Paso 3**:
   Se creó [`PkOptimizationCard.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/tools/db-sync-common/PkOptimizationCard.tsx) con su hoja de estilos modular [`.module.css`](file:///c:/Alekos/Projects/gis-tools/src/components/tools/db-sync-common/PkOptimizationCard.module.css), permitiendo:
   - Visualizar la clave primaria detectada (ej. `id`).
   - Conmutar la optimización mediante switch interactivo.
   - Seleccionar o anular manualmente la columna de clave primaria si el usuario lo prefiere.

4. **Generación Inteligente de `WHERE` en `SqlPatchGenerator`**:
   - Para sentencias `UPDATE`: Si `primaryKeyColumn` está presente y definida en `dbRecord`, se genera `WHERE "<primaryKeyColumn>" = <valor>`. En caso contrario, se aplica fallback transparente a la clave SUID compuesta.
   - Seguridad en `SET`: La columna de clave primaria se excluye explícitamente de las cláusulas `SET` para prevenir sobreescrituras accidentales de la PK.
   - Sentencias `INSERT`: Se mantienen estrictamente intactas, insertando los atributos del SUID de negocio y permitiendo que las secuencias o identidades de PostgreSQL generen las nuevas PKs de forma nativa.

---

## 4. Code Examples & Diff Snippets

### A. Introspección en `src/app/api/db/columns/route.ts`:
```typescript
// Detección segura de clave primaria en catálogo PostgreSQL
let primaryKeyColumn: string | null = null;
try {
  const pkQuery = `
    SELECT a.attname
    FROM pg_index i
    JOIN pg_attribute a 
      ON a.attrelid = i.indrelid 
     AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = format('%I.%I', $1, $2)::regclass
      AND i.indisprimary;
  `;
  const pkRes = await client.query(pkQuery, [schema, table_name]);
  if (pkRes.rows.length === 1) {
    primaryKeyColumn = String(pkRes.rows[0].attname);
  }
} catch {
  primaryKeyColumn = null;
}
```

### B. Cláusula WHERE Optimizada en `src/workers/comparison/SqlPatchGenerator.ts`:
```typescript
// Antes (siempre clave compuesta, riesgo de Seq Scan):
private buildWhereClause(dbRecord: Record<string, unknown>): string {
  const conditions = this.dbSuidCols.map((col) =>
    this.sqlBuilder.formatWhereCondition(col, dbRecord[col])
  );
  return conditions.join(" AND ");
}

// Ahora (búsqueda instantánea por PK indexada B-Tree con fallback):
private buildWhereClause(dbRecord: Record<string, unknown>): string {
  const primaryKeyColumn = this.mappingConfig.primaryKeyColumn;
  if (primaryKeyColumn && dbRecord[primaryKeyColumn] != null) {
    return this.sqlBuilder.formatWhereCondition(
      primaryKeyColumn,
      dbRecord[primaryKeyColumn]
    );
  }

  const conditions = this.dbSuidCols.map((col) =>
    this.sqlBuilder.formatWhereCondition(col, dbRecord[col])
  );
  return conditions.join(" AND ");
}
```

---

## 5. Verification & Testing

- **TypeScript Type Check**: `npx tsc --noEmit` completó con código de salida `0` (0 errores).
- **ESLint**: `npm run lint` pasó limpiamente con 0 advertencias y 0 errores.
- **React Doctor**: `npm run doctor` reportó **Score: 100 / 100 Great — ✔ No issues found!**.
- **Producción Next.js**: `npm run build` compiló exitosamente todas las rutas y páginas estáticas/dinámicas en 2.1s con Turbopack.
