# Issue #013: Desincronización entre Tarjetas KPI y Tabla de Discrepancias (Falsas Discrepancias de Atributos con NULL)

## 1. Problem Statement

Al analizar los resultados de la comparación entre una tabla PostGIS y un archivo CSV en el Paso 4 (*Resultados de Evaluación*), se observaron dos inconsistencias visuales graves:

1. **Tabla poblada con 0 discrepancias**: Cuando la tarjeta KPI de *Discrepancias Atributos* marcaba **0**, al seleccionarla la tabla inferior mostraba más de **298.000 filas** con la insignia `Diferencia de Atributos`.
2. **Comparación contra `(Vacío / NULL)`**: En dicha tabla, todos los campos de la base de datos se comparaban contra `(Vacío / NULL)` en el archivo, a pesar de que el archivo CSV contenía registros normales y los registros mostrados pertenecían en realidad a filas que solo existían en la base de datos (`ONLY_IN_DB`).

---

## 2. Root Cause Analysis & Technical Details

### A. Filtro Laxo en `useDiscrepanciesTableData.ts`
El hook responsable de paginar y filtrar la tabla evaluaba el filtro de la siguiente manera:
```typescript
if (activeFilter === DiscrepancyFilter.ATTRIBUTE_MISMATCH) {
  matchesFilter = item.differences.length > 0;
}
```
En lugar de validar que el ítem fuera de tipo `DiscrepancyType.ATTRIBUTE_MISMATCH`, simplemente comprobaba si tenía diferencias (`differences.length > 0`).

Dado que los registros clasificados como `ONLY_IN_DB` (registros ausentes en el archivo) y `DUPLICATE_SUID` contienen un desglose de campos donde `shpValue: null`, **todos los 210.000+ registros de `ONLY_IN_DB` y 88.000+ registros duplicados cumplían esa condición** y se filtraban dentro de *Discrepancias de Atributos*.

### B. Sobrescritura Forzada de la Insignia en `DiscrepancyItemRows.tsx`
El componente de fila renderizaba la insignia de estado forzando el tipo del filtro activo:
```typescript
const displayBadgeType = isGeometryCard
  ? DiscrepancyType.GEOMETRY_MISMATCH
  : isAttributeCard
  ? DiscrepancyType.ATTRIBUTE_MISMATCH
  : item.type;
```
Esto hacía que filas que eran en realidad `Solo en Base de Datos` o `SUID Duplicado` mostraran falsamente la insignia `Diferencia de Atributos`, engañando al usuario al hacerle creer que el motor detectaba valores nulos en el archivo CSV.

---

## 3. Implemented Solution

Se adoptó el **Modelo de Clasificación Estricta 1-a-1 (Opción A)**:

1. **Filtro Canónico Unificado en `useDiscrepanciesTableData.ts`**:
   Se alineó el filtro con [`useDiscrepancyGeojson.ts`](src/hooks/useDiscrepancyGeojson.ts#L132):
   ```typescript
   const matchesFilter =
     activeFilter === DiscrepancyFilter.ALL || item.type === activeFilter;
   ```
   Ahora, cada tarjeta KPI filtra exactamente los ítems correspondientes a su categoría canónica:
   - *Discrepancias Atributos (0)* $\to$ muestra exactamente 0 filas.
   - *Discrepancias Atributos (152)* $\to$ muestra exactamente las 152 filas con diferencias reales entre BD y CSV.
   - *Solo en Base de Datos* $\to$ muestra las filas que solo existen en la BD con su insignia correspondiente.
   - *SUIDs Duplicados* $\to$ muestra las filas duplicadas con su insignia correspondiente.

2. **Insignia Fiel al Tipo Real en `DiscrepancyItemRows.tsx`**:
   Se eliminó la sobrescritura artificial del badge:
   ```typescript
   const displayBadgeType = item.type;
   ```
   Cada fila muestra siempre su insignia real y legítima.

---

## 4. Code Examples & Diff Snippets

### A. Filtro en `useDiscrepanciesTableData.ts`:
```typescript
// Antes (fuga masiva de ONLY_IN_DB y DUPLICATE_SUID):
if (activeFilter === DiscrepancyFilter.ATTRIBUTE_MISMATCH) {
  matchesFilter = item.differences.length > 0;
}

// Ahora (estricto y exacto):
const matchesFilter =
  activeFilter === DiscrepancyFilter.ALL || item.type === activeFilter;
```

### B. Renderizado de Insignia en `DiscrepancyItemRows.tsx`:
```typescript
// Antes:
const displayBadgeType = isAttributeCard ? DiscrepancyType.ATTRIBUTE_MISMATCH : item.type;

// Ahora:
const displayBadgeType = item.type;
```

---

## 5. Verification & Testing

- **TypeScript**: `npx tsc --noEmit` completó con código de salida `0` (0 errores).
- **ESLint**: `npm run lint` pasó limpiamente con 0 advertencias y 0 errores.
- **Validación Visual**: Al seleccionar *Discrepancias Atributos*, el contador de la tarjeta KPI y el total de la tabla coinciden exactamente (0 con 0, 152 con 152), eliminando la aparición espuria de registros nulos de `ONLY_IN_DB`.
