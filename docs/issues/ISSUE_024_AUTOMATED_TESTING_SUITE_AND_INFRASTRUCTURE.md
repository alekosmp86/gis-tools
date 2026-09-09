# Issue #021: Infraestructura de Pruebas Automatizadas (Vitest + Playwright) y Suite de Servicios y Parsers

## 1. Problem Statement

La plataforma acumulaba una creciente complejidad en servicios críticos del dominio GIS:
1. Algoritmos de corrección de mojibake y tolerancia heurística a corrupción de codificación (`GisEncodingNormalizer`, `GisStringSanitizer`).
2. Parsers geométricos de WKT y Extended WKB (`WktGeometryParser`, `EwkbGeometryParser`).
3. Normalizadores y comparadores topológicos con tolerancia a precisión flotante (`SpatialGeometryComparator`, `PolygonRingNormalizer`).
4. Parsers de formatos de archivo delimitados y detección de coordenadas (`CsvParser`).
5. Motores de comparación e indexación hash de registros SUID (`SuidKeyResolver`, `FileDatasetIndexer`).
6. Generadores de parches SQL para PostgreSQL/PostGIS (`SqlPatchGenerator`).

La ausencia de un arnés de pruebas automatizadas limitaba la detección temprana de regresiones y dependía exclusivamente de pruebas manuales y scripts ad-hoc en el directorio `scratch/`.

---

## 2. Root Cause Analysis & Technical Details

1. **Falta de Runner de Pruebas Unitarias de Alto Rendimiento**:
   - Next.js con Turbopack carecía de configuración para ejecutar suites unitarias herméticas en milisegundos con soporte nativo para TypeScript y aliases de ruta (`@/*`).
2. **Ausencia de Preparación para Pruebas E2E / UI**:
   - No existía infraestructura o andamiaje para pruebas de navegador automatizadas de extremo a extremo que validasen el flujo de asistentes (*wizards*) de 5 pasos.
3. **Discrepancias Sutiles Descubiertas por la Suite**:
   - Durante la ejecución de las pruebas se identificó una colisión de claves en el `recordsMap` de `CsvParser` al mapear índices numéricos sin prefijo junto a identificadores naturales (`id`/`suid`), lo cual fue detectado y corregido inmediatamente gracias a la especificación de los tests.
   - En `PolygonRingNormalizer`, el método de coincidencia topológica requería un punto de entrada explícito `areRingsTopologicallyMatching` que delegase en la alineación cíclica con epsilon.

---

## 3. Implemented Solution

1. **Branch Aislada**:
   - Creada y utilizada la rama `testing`.

2. **Pila Tecnológica de Pruebas (Unit + E2E)**:
   - **Vitest** (`vitest` + `vite`): Configurado mediante [`vitest.config.mts`](vitest.config.mts) con resolución nativa de TypeScript paths (`resolve.tsconfigPaths: true`), ejecución en entorno Node y cobertura con proveedor V8.
   - **Playwright** (`@playwright/test`): Andamiaje configurado en [`playwright.config.ts`](playwright.config.ts) y prueba de humo inicial en [`tests/e2e/smoke.test.ts`](tests/e2e/smoke.test.ts).

3. **Normas y Estándares de Pruebas**:
   - Codificados en [`.agents/rules/testing_standards.md`](.agents/rules/testing_standards.md) y en [`AGENTS.md`](AGENTS.md).
   - *Regla de Oro*: Las pruebas son la especificación definitiva. Nunca se alteran aserciones para maquillar código fallido; el código fuente debe corregirse para satisfacer la especificación.
   - Estructura Arrange-Act-Assert (AAA), nombres descriptivos y cobertura exhaustiva de casos de borde.

4. **Suites Unitarias Implementadas (`tests/unit/`)**:
   - `tests/unit/utils/common/GisEncodingNormalizer.test.ts` (14 pruebas).
   - `tests/unit/utils/common/GisStringSanitizer.test.ts` (8 pruebas).
   - `tests/unit/utils/spatial/WktGeometryParser.test.ts` (7 pruebas).
   - `tests/unit/utils/spatial/EwkbGeometryParser.test.ts` (5 pruebas).
   - `tests/unit/utils/spatial/SpatialGeometryComparator.test.ts` (6 pruebas).
   - `tests/unit/utils/spatial/PolygonRingNormalizer.test.ts` (5 pruebas).
   - `tests/unit/services/parsers/CsvParser.test.ts` (5 pruebas).
   - `tests/unit/workers/comparison/SuidKeyResolver.test.ts` (5 pruebas).
   - `tests/unit/workers/comparison/FileDatasetIndexer.test.ts` (3 pruebas).
   - `tests/unit/workers/comparison/SqlPatchGenerator.test.ts` (3 pruebas).

---

## 4. Code Examples & Diff Snippets

### A. Ejecución de Pruebas con Vitest
```bash
npm test
# Ejecuta 10 suites de prueba y 61 pruebas unitarias en ~650ms
```

### B. Ejemplo de Suite (AAA & Casos de Borde en `GisEncodingNormalizer.test.ts`)
```typescript
it("should resolve Hangul double-byte corruption against clean database text when tolerance is enabled", () => {
  // Arrange
  const dbValue = "INSTRUCCIONES DEL AÑO XIII";
  const fileValue = "INSTRUCCIONES DEL A헡 XIII";

  // Act
  const result = GisEncodingNormalizer.areAttributesEquivalent(dbValue, fileValue, {
    ignoreEncodingArtifacts: true,
  });

  // Assert
  expect(result).toBe(true);
});
```

---

## 5. Verification & Testing

| Verificación | Comando | Resultado |
| :--- | :--- | :--- |
| **Suite Unitaria** | `npm test` | **PASS (10/10 archivos, 61/61 pruebas en <1s)** |
| **React Doctor** | `npm run doctor` | **100 / 100 Great (0 advertencias, 0 errores)** |
| **ESLint** | `npm run lint` | **PASS (0 errores, 0 warnings)** |
| **Next.js Build** | `npm run build` | **PASS (Turbopack exit 0, 13 rutas compiladas)** |
| **Grafo de Dependencias** | `npm run graph` | **PASS (0 ciclos)** |
