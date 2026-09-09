# Issue #019: Tolerancia a Artefactos y Glitches de Codificación en Exportaciones GIS (Caracteres Ñ y Mojibake)

## 1. Problem Statement

Durante los procesos de sincronización entre bases de datos PostgreSQL/PostGIS y archivos espaciales externos (Shapefiles/DBF o CSV), el motor de comparación reportaba discrepancias de atributos falsas (*false positives*) en registros de texto que contenían caracteres especiales españoles como la letra `Ñ` o tildes.

Un ejemplo específico y documentado por el usuario:
- **Valor en Base de Datos**: `INSTRUCCIONES DEL AÑO XIII`
- **Valor en Archivo (Shapefile/DBF)**: `INSTRUCCIONES DEL A헡 XIII`
- **SUID del registro**: `28449 | 63 | N/A | SALTO`

El motor reportaba este registro como `ATTRIBUTE_MISMATCH` generando sentencias `UPDATE` innecesarias, a pesar de que ambos textos se refieren inequívocamente al mismo nombre de vía y la diferencia radicaba exclusivamente en una corrupción de codificación generada durante la exportación del archivo.

---

## 2. Root Cause Analysis & Technical Details

### A. Corrupción por Interpretación Double-Byte (DBCS / Codepage Misinterpretation)
El análisis binario del carácter corrupto reveló:
- Carácter: `'헡'`
- Código Unicode: `0xD5E1` (Sílaba Hangul coreana)
- Origen: En exportadores GIS heredados y herramientas de procesamiento de tablas DBF/Shapefiles que operan en sistemas con codepages de doble byte (DBCS, CP949 o conversiones erróneas Latin-1 / UTF-16), los bytes de la secuencia española `ÑO` (`0xD1 0x4F` en Latin-1/Windows-1252) se empaquetan y leen como una sola unidad de 16 bits `0xD5E1`, dando lugar al glifo coreano `헡`. Similarmente, `Ã‘` ocurre cuando texto codificado en UTF-8 es leído bajo Windows-1252.

### B. Comparación Estricta de Cadenas sin Normalización de Glitches
En [`src/workers/comparison/FeatureAttributeExtractor.ts`](src/workers/comparison/FeatureAttributeExtractor.ts), la comparación de valores de atributos entre la base de datos y el archivo se realizaba mediante comparación estricta de igualdad por valor limpio:

```typescript
// Código Anterior
const dbCleaned = this.suidResolver.cleanRawValue(dbVal);
const fileCleaned = this.suidResolver.cleanRawValue(fileVal);

if (dbCleaned !== fileCleaned) {
  differences.push({
    fieldName: field,
    dbValue: dbVal as string | number | null,
    shpValue: fileVal as string | number | null,
  });
}
```

Al no contar con un reconocedor de fallas de codificación frecuentes, cualquier exportación corrupta producía una discrepancia en el conjunto de resultados.

### C. Restricciones del Usuario
El usuario estableció dos restricciones de diseño estrictas:
1. **Sensibilidad a Mayúsculas y Minúsculas**: La solución no debía convertir a minúsculas indiscriminadamente (`case-sensitive`). `A헡` no debe considerarse equivalente a `año`.
2. **Sensibilidad a Signos de Puntuación**: No se debían ignorar comas, puntos o signos gramaticales (`punctuation-sensitive`). `A헡, XIII` no debe considerarse equivalente a `AÑO XIII`.

---

## 3. Implemented Solution

Se diseñó una arquitectura de normalización y detección de artefactos de codificación de alta fidelidad **completamente genérica y sin cadenas hardcodeadas**:

1. **Nuevo Servicio de Dominio `GisEncodingNormalizer`**:
   Ubicado en [`src/utils/common/GisEncodingNormalizer.ts`](src/utils/common/GisEncodingNormalizer.ts), implementa:
   - `algorithmicUnmojibake(value: string)`: Decodificador algorítmico que detecta secuencias de bytes UTF-8 erróneamente interpretadas como Windows-1252 / ISO-8859-1 y reconstruye dinámicamente la cadena UTF-8 original. Soporta todas las combinaciones de vocales con tildes, diéresis y la letra `Ñ`/`ñ` (`PEÃ‘AROL` $\rightarrow$ `PEÑAROL`, `CABAÃ‘A` $\rightarrow$ `CABAÑA`, `MÃ‰NDEZ` $\rightarrow$ `MÉNDEZ`, etc.) de forma universal sin tablas de palabras o letras fijas.
   - `hasCorruptedGlyphs(value: string)`: Detector de caracteres anómalos que identifica rangos Unicode que jamás pertenecen al español en cartografía (sílabas Hangul `\uAC00-\uD7AF`, ideogramas CJK `\u4E00-\u9FFF`, caracteres de reemplazo `\uFFFD`, zonas de uso privado y caracteres de control ASCII).
   - `matchesCorruptedAgainstClean(corruptedStr, cleanStr)`: Alineador dinámico y contextual. Convierte cada glifo corrupto en un comodín acotado (1 a 2 letras españolas válidas) e inspecciona el contexto del token (mayúsculas, minúsculas o TitleCase) para exigir que las letras genuinas en la base de datos coincidan exactamente en casing y preserven estrictamente signos de puntuación y texto circundante.
   - `areAttributesEquivalent(valDb, valFile, options)`: Orquestador de equivalencia con fast-path $O(1)$ para valores idénticos, unmojibake algorítmico bidireccional y alineación difusa contextual.

2. **Integración en `GisStringSanitizer` y `SuidKeyResolver`**:
   En [`src/utils/common/GisStringSanitizer.ts`](src/utils/common/GisStringSanitizer.ts) y [`src/workers/comparison/SuidKeyResolver.ts`](src/workers/comparison/SuidKeyResolver.ts), se incorporó el método `areValuesEquivalent` y se aplicó `repairEncoding` en `cleanSuid` para asegurar que las claves compuestas se reconozcan mutuamente entre la base de datos y el archivo.

3. **Inyección en el Flujo del Web Worker (`FeatureAttributeExtractor` & `MatchedRecordsComparator`)**:
   - `ExtractFeatureParams` recibe el flag `ignoreEncodingArtifacts` (por defecto `true`).
   - Se reemplazó la comparación `dbCleaned !== fileCleaned` por `this.suidResolver.areValuesEquivalent(...)`.
   - `MatchedRecordsComparator` transfiere la opción configurada en `ColumnMappingConfig`.

4. **Saneamiento Automático de Sentencias SQL (`SqlScriptBuilder`)**:
   En [`src/workers/comparison/SqlScriptBuilder.ts`](src/workers/comparison/SqlScriptBuilder.ts), se integró `repairEncoding` dentro de `formatSqlValue` para asegurar que al generar sentencias `INSERT` o `UPDATE`, los valores importados a PostgreSQL queden limpios y sin caracteres corruptos.

5. **Componente UI Modular `EncodingToleranceCard`**:
   - Componente atómico [`EncodingToleranceCard.tsx`](src/components/tools/db-sync-common/EncodingToleranceCard.tsx) con hoja de estilos modular [`.module.css`](src/components/tools/db-sync-common/EncodingToleranceCard.module.css).
   - Switch de control de tolerancia con insignias dinámicas (*Tolerancia Activa* vs *Comparación Estricta Byte a Byte*).
   - Integrado en el paso 3 del asistente de sincronización ([`SuidMappingStep.tsx`](src/components/tools/db-sync-common/SuidMappingStep.tsx)) y gestionado en el hook [`useSuidMappingForm.ts`](src/hooks/useSuidMappingForm.ts).

---

## 4. Code Examples & Diff Snippets

### A. Detección y Alineación Dinámica en `GisEncodingNormalizer.ts`
```typescript
export class GisEncodingNormalizer {
  private static readonly CORRUPTED_GLYPH_REGEX =
    /[\uFFFD\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u30FF\uFF00-\uFFEF\uE000-\uF8FF\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/;

  public static algorithmicUnmojibake(value: string): string {
    if (!value || !/[ÃÂ]/.test(value)) return value;
    try {
      const byteList = [];
      for (let index = 0; index < value.length; index++) {
        const codePoint = value.charCodeAt(index);
        byteList.push(codePoint < 256 ? codePoint : GisEncodingNormalizer.WIN1252_LOOKUP[codePoint]);
      }
      return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(byteList));
    } catch {
      return value;
    }
  }

  public static areAttributesEquivalent(
    databaseValue: unknown,
    fileValue: unknown,
    options?: AttributeEquivalenceOptions
  ): boolean {
    if (databaseValue === fileValue) return true;
    if (databaseValue == null || fileValue == null) return false;
    // Unmojibake algorítmico universal
    const unmojibakeDb = GisEncodingNormalizer.algorithmicUnmojibake(String(databaseValue).trim());
    const unmojibakeFile = GisEncodingNormalizer.algorithmicUnmojibake(String(fileValue).trim());
    if (unmojibakeDb === unmojibakeFile) return true;

    // Alineación dinámica con estricto respeto a mayúsculas y puntuación
    return (
      GisEncodingNormalizer.matchesCorruptedAgainstClean(unmojibakeFile, unmojibakeDb) ||
      GisEncodingNormalizer.matchesCorruptedAgainstClean(unmojibakeDb, unmojibakeFile)
    );
  }
}
```

### B. Extractor de Atributos en `FeatureAttributeExtractor.ts`
```diff
- const dbCleaned = this.suidResolver.cleanRawValue(dbVal);
- const fileCleaned = this.suidResolver.cleanRawValue(fileVal);
- if (dbCleaned !== fileCleaned) {
+ const areEqual = this.suidResolver.areValuesEquivalent(dbVal, fileVal, {
+   ignoreEncodingArtifacts,
+ });
+ if (!areEqual) {
    differences.push({
      fieldName: field,
      dbValue: dbVal as string | number | null,
      shpValue: fileVal as string | number | null,
    });
  }
```

---

## 5. Verification & Testing

Se verificaron todos los casos de prueba unitarios mediante el script de validación automatizada [`scripts/test-encoding-glitch.cjs`](scripts/test-encoding-glitch.cjs):

1. **Caso real reportado**:
   `INSTRUCCIONES DEL A헡 XIII` vs `INSTRUCCIONES DEL AÑO XIII` $\rightarrow$ `true` (Aprobado).
2. **Sensibilidad estricta a mayúsculas/minúsculas**:
   `INSTRUCCIONES DEL a헡 XIII` vs `INSTRUCCIONES DEL AÑO XIII` $\rightarrow$ `false` (Aprobado).
3. **Sensibilidad estricta a puntuación**:
   `INSTRUCCIONES DEL A헡, XIII` vs `INSTRUCCIONES DEL AÑO XIII` $\rightarrow$ `false` (Aprobado).
4. **Mojibake UTF-8**:
   `PEÃ‘AROL` vs `PEÑAROL` $\rightarrow$ `true` (Aprobado).
5. **Modo estricto desactivado**:
   `INSTRUCCIONES DEL A헡 XIII` vs `INSTRUCCIONES DEL AÑO XIII` con `ignoreEncodingArtifacts: false` $\rightarrow$ `false` (Aprobado).
6. **Nombres distintos**:
   `INSTRUCCIONES DEL A헡 XIII` vs `AVENIDA 18 DE JULIO` $\rightarrow$ `false` (Aprobado).
