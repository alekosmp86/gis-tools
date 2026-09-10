# Playwright E2E & Characterization Test Suite

Este directorio alberga la suite de pruebas de caracterización y extremo a extremo (E2E) construida con **Playwright**.

---

## 1. Alcance: `tests/e2e/` vs. `tests/unit/`

| Dimensión | `tests/unit/` (Vitest) | `tests/e2e/` (Playwright) |
|---|---|---|
| **Entorno** | Node.js puro (`environment: "node"`) | Navegador real Chromium headless / headed |
| **Objetivo** | Verificación hermética de lógica de dominio, parseadores espaciales (`shpjs`, `BinaryShpReader`, `CsvParser`), parsers EWKB y generadores SQL. | Caracterización de flujos UI completos, interacción del usuario y navegación entre pasos de herramientas. |
| **Dependencia DOM** | Ninguna (no utiliza jsdom ni Testing Library). | Control total del DOM mediante selectores accesibles por rol y texto. |
| **Tiempo de ejecución** | Milisegundos por suite. | Segundos por flujo de integración. |

---

## 2. Filosofía de Caracterización y Protección de Refactorización

1. **Red de Seguridad para Componentes Complejos (God Components)**:
   - Las herramientas de sincronización (`/tools/db-csv-sync`, `/tools/db-shapefile-sync`, `/tools/db-db-sync`) y la vista común `ComparisonResultsView` concentran un alto acoplamiento de estado.
   - Estas pruebas fijan el comportamiento observable externo **antes** de emprender cualquier descomposición o extracción de wizard compartido.
2. **Resiliencia ante Refactorizaciones**:
   - Al no atarse a fronteras internas de componentes ni nombres de clases CSS, un cambio en la estructura de componentes o en el diseño modular no rompe las pruebas mientras se preserve el contrato observable.
3. **Caracterización del Comportamiento Actual (Regla D4)**:
   - Las pruebas deben asertar cómo se comporta la aplicación **hoy en día**, incluyendo peculiaridades o defectos observados (ej. re-inicialización de estado en retrocesos de wizard o manejo de códigos de estado HTTP en el cliente).
   - Cualquier defecto descubierto se documenta en el informe para el orquestador (`TO_ORCHESTRATOR.md`) sin alterar el código de aplicación en la misión de testing.

---

## 3. Convención de Mocks y Aislamiento (`mockBackend`)

- **Cero Dependencia de Base de Datos**: No se requiere una instancia de PostGIS en ejecución.
- Todas las llamadas de red a la API interna son interceptadas herméticamente mediante `page.route()` a través del helper:
  ```ts
  import { test, expect } from "../support/testFixture";

  test.describe("Flujo Ejemplo", () => {
    test.beforeEach(async ({ mockBackend }) => {
      await mockBackend();
    });
    // ...
  });
  ```
- **Fixtures Saneadas y Personalizables**:
  - `tests/e2e/fixtures/dbFixtures.ts`: Mock de metadata de columnas, respuestas de prueba de conexión, ejecución SQL y generador de streaming NDJSON (`META`, `CHUNK`, `DONE`).
  - `tests/e2e/fixtures/watcherFixtures.ts`: Mock de fuentes vigiladas, métricas de actualización y grupos de catálogo CKAN.
  - `tests/e2e/fixtures/sampleFiles.ts`: Contenidos de prueba en CSV y GeoJSON con discrepancias conocidas.
  - Se pueden sobrescribir endpoints específicos por test:
    ```ts
    await mockBackend({
      recordsStatus: 500, // Forzar error en streaming
    });
    ```

---

## 4. Guardia de Consola y Errores de Página (`testFixture`)

- Todos los tests utilizan el runner extendido en `tests/e2e/support/testFixture.ts`.
- **Detección Automática de Anomalías**:
  - Cualquier llamada a `console.error` o evento `pageerror` (como desajustes de hidratación en React, promesas rechazadas no capturadas o errores de React Query) es capturada e inspeccionada en la etapa de teardown, provocando la falla del test al finalizar su ejecución si se detectaron anomalías no permitidas.
- **Excepción Explícita para Flujos de Error**:
  - Si un test evalúa intencionalmente una ruta de error que genera logs en consola (ej. respuesta HTTP 400/500 del servidor), debe invocar explícitamente:
    ```ts
    test("flujo de error", async ({ mockBackend, allowConsoleErrors }) => {
      allowConsoleErrors();
      // ...
    });
    ```

---

## 5. Ejecución de Pruebas

```bash
# Ejecución estándar headless (todas las pruebas E2E)
npm run test:e2e

# Ejecución con interfaz gráfica interactiva de Playwright
npm run test:e2e:ui

# Ejecución con navegador visible (headed) para inspección visual
npm run test:e2e:headed
```
