# Issue #020: Desacoplamiento de Mapeo SUID, Nuevo Paso 4 de Parámetros de Sincronización y Renombrado a `ComparisonResultsView`

## 1. Problem Statement

En las tres herramientas de sincronización de la plataforma (`db-shapefile-sync`, `db-csv-sync` y `db-db-sync`), el asistente (*wizard*) constaba de 4 pasos donde el **Paso 3 (`SuidMappingStep`)** acumulaba múltiples responsabilidades heterogéneas:
1. **Mapeo de Datos (Puro)**: Definición de columnas SUID, mapeo 1-a-1 de atributos y activación de topología espacial.
2. **Parámetros de Ejecución y Generación SQL**: Tolerancia a glitches de codificación, optimización de cláusulas `WHERE` en sentencias `UPDATE` por clave primaria y valores por defecto para columnas `NOT NULL` en sentencias `INSERT`.

Esta sobrecarga en un único paso confundía al usuario con configuraciones de bajo nivel de bases de datos y codificación antes de haber establecido con claridad qué columnas se iban a comparar.

Asimismo, el componente visualizador de resultados se denominaba rígidamente [`Step4ResultsView.tsx`](src/components/tools/db-sync-common/ComparisonResultsView.tsx), atando su identidad a un número de paso específico que deja de ser válido al expandir el flujo del asistente.

---

## 2. Root Cause Analysis & Technical Details

### A. Violación del Principio de Responsabilidad Única (SRP) en el Paso 3
El componente [`SuidMappingStep.tsx`](src/components/tools/db-sync-common/SuidMappingStep.tsx) y su hook [`useSuidMappingForm.ts`](src/hooks/useSuidMappingForm.ts) gestionaban simultáneamente:
- Claves de negocio y correspondencia de nombres de atributos.
- Estrategia de optimización de índices B-Tree de PostgreSQL (`WHERE id = ...`).
- Reglas de negocio para parches `INSERT` de campos obligatorios no mapeados.
- Banderas heurísticas de decodificación de caracteres corruptos.

### B. Acoplamiento Numérico en Componentes de Resultados
Nombrar componentes de vista con prefijos ordinales de paso (`Step4ResultsView`) genera deuda técnica y fragilidad arquitectónica cuando los asistentes de usuario evolucionan y agregan o reordenan etapas intermedias.

---

## 3. Implemented Solution

Se implementó una reestructuración desacoplada en **5 pasos modulares**:

1. **Nuevo Paso Intermedio: `SyncParametersStep` (Paso 4)**:
   - Creado en [`src/components/tools/db-sync-common/SyncParametersStep.tsx`](src/components/tools/db-sync-common/SyncParametersStep.tsx) con su CSS modular.
   - Agrupa en un layout limpio y focalizado:
     - `EncodingToleranceCard`: Control de tolerancia a fallas de codificación (caracteres `Ñ`, Hangul, mojibake).
     - `PkOptimizationCard`: Optimización de sentencia `UPDATE` con `WHERE "id" = ...`.
     - `InsertDefaultsCard`: Asignación de valores por defecto para columnas `NOT NULL` en inserciones.
   - Implementa `React.forwardRef<SyncParametersStepRef>` para orquestación imperativa fluida con `WizardOrchestrator`.

2. **Nuevo Hook Especializado: `useSyncParametersForm`**:
   - Creado en [`src/hooks/useSyncParametersForm.ts`](src/hooks/useSyncParametersForm.ts).
   - Gestiona de forma aislada la tolerancia, la clave primaria efectiva y los defaults de inserción, calculando `unmappedDbColumns` a partir del mapeo previo del Paso 3.

3. **Purificación del Paso 3: `SuidMappingStep`**:
   - Refactorizado [`SuidMappingStep.tsx`](src/components/tools/db-sync-common/SuidMappingStep.tsx) y [`useSuidMappingForm.ts`](src/hooks/useSuidMappingForm.ts) para contener exclusivamente:
     - `SuidSelectorCard`: Selección de identificador SUID simple o compuesto.
     - `AttributeFieldsCard`: Mapeo de atributos 1 a 1.
     - `GeometryToggleCard`: Comparación de geometrías espaciales.
   - El botón siguiente transiciona limpiamente a *"Continuar a Parámetros de Sincronización"*.

4. **Renombrado Agnóstico: `Step4ResultsView` $\rightarrow$ `ComparisonResultsView`**:
   - Renombrado el archivo a [`ComparisonResultsView.tsx`](src/components/tools/db-sync-common/ComparisonResultsView.tsx) y su hoja de estilos a `ComparisonResultsView.module.css`.
   - Renombrada la interfaz a `ComparisonResultsViewProps` y el componente a `ComparisonResultsView`.
   - Se mantuvo un alias de retrocompatibilidad exportado para evitar rupturas en importaciones heredadas.

5. **Actualización del Wizard en las 3 Herramientas**:
   - [`db-shapefile-sync/page.tsx`](src/app/tools/db-shapefile-sync/page.tsx), [`db-csv-sync/page.tsx`](src/app/tools/db-csv-sync/page.tsx) y [`db-db-sync/page.tsx`](src/app/tools/db-db-sync/page.tsx) actualizados a la arquitectura de 5 pasos con preservación bidireccional de estados.

---

## 4. Code Examples & Diff Snippets

### A. Definición de Pasos en `db-shapefile-sync/page.tsx`
```tsx
const steps: WizardStepDef[] = [
  // Paso 1: Conexión DB
  { id: 1, title: "Base de Datos", content: <DbConnectionForm ... /> },
  // Paso 2: Carga Capa
  { id: 2, title: "Capa Espacial", content: <ShapefileUploader ... /> },
  // Paso 3: Mapeo Puro
  {
    id: 3,
    title: "Mapeo SUID",
    nextLabel: "Continuar a Parámetros de Sincronización",
    content: <SuidMappingStep ref={suidMappingRef} ... />,
  },
  // Paso 4: Parámetros Avanzados
  {
    id: 4,
    title: "Parámetros",
    icon: Sliders,
    nextLabel: "Iniciar Análisis y Comparación",
    content: <SyncParametersStep ref={syncParametersRef} ... />,
  },
  // Paso 5: Resultados Agnósticos
  {
    id: 5,
    title: "Resultados",
    content: <ComparisonResultsView ... />,
  },
];
```

---

## 5. Verification & Testing

1. **Auditoría de Grafos de Dependencia**: `npm run graph` ejecutado con 0 dependencias circulares detectadas.
2. **ESLint**: `npm run lint` superado con 0 errores y 0 advertencias.
3. **React Doctor**: `npm run doctor` superado con puntuación 100/100 Great.
4. **Build de Producción**: `npm run build` compilado exitosamente con Next.js Turbopack en todas las rutas.
5. **Preservación de Estado Bidireccional**: Se validó que al retroceder de Paso 5 $\rightarrow$ Paso 4 $\rightarrow$ Paso 3, todas las selecciones de SUID, atributos, switches de tolerancia, optimización PK y valores por defecto se conservan intactas.
