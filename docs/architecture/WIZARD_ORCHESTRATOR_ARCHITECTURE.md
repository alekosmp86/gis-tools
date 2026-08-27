# Arquitectura del Orquestador de Wizard y Desacoplamiento de Pasos

> **Módulo**: `src/components/shared/WizardOrchestrator.tsx` & `.module.css`  
> **Fecha**: 2026-08-27  
> **Estado**: Implementado & Puesto en Producción  

---

## 1. Visión General y Motivación

Anteriormente, cada formulario y vista interior (`DbConnectionForm`, `CsvUploader`, `ShapefileUploader`, `SuidMappingStep`, `Step4ResultsView`) administraba sus propios encabezados fijos (ej. `1. Configurar Conexión...`) y sus propios botones de navegación interna para avanzar o retroceder de paso.

Esta responsabilidad cruzada acoplaba de forma rígida los componentes interiores a un número de paso específico, impidiendo su reutilización en otros flujos de trabajo (como en la herramienta de sincronización DB vs. DB, donde se requieren dos instancias de conexión a BD).

### Solución Implementada: Patrón Orquestador Declarativo (`WizardOrchestrator`)
Se creó el componente contenedor **`WizardOrchestrator`** que asume la responsabilidad exclusiva de:
1. Renderizar la **barra stepper de progreso** (`StepIndicator`).
2. Envolver el contenido del paso activo en una **tarjeta master glassmorphism** con bordes y luces de acento.
3. Mostrar la **cabecera unificada** del paso activo (Pill `Paso N de M`, título, subtítulo e icono).
4. Proveer la **barra de navegación inferior** con botones de `Volver` y `Continuar`.
5. Ejecutar **desplazamiento automático suave (Smooth Scroll)** hacia el tope del wizard en cada transición de paso.

---

## 2. Definiciones de Tipos (`src/types/ui.ts`)

```typescript
export interface WizardStepDef {
  id: number;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  content: React.ReactNode;
  canProceed?: boolean;
  onNext?: () => void;
  nextLabel?: string;
  onBack?: () => void;
  backLabel?: string;
  hideFooter?: boolean;
}

export interface WizardOrchestratorProps {
  steps: WizardStepDef[];
  currentStep: number;
  onStepClick?: (stepId: number) => void;
  step1Title?: string;
  step1Subtitle?: string;
  fileStepTitle?: string;
  fileStepSubtitle?: string;
}
```

---

## 3. Patrón de Referencias Imperativas (`React.forwardRef`)

Para mantener los formularios y cargadores interiores 100% agnósticos al paso en el que se encuentran, los componentes exponen un método imperativo `proceed()` mediante `React.forwardRef` y `useImperativeHandle`:

### Ejemplo: `DbConnectionForm.tsx`
```typescript
export interface DbConnectionFormRef {
  proceed: () => void;
}

export const DbConnectionForm = React.forwardRef<DbConnectionFormRef, DbConnectionFormProps>(
  ({ onSuccess, onStatusChange }, ref) => {
    const { handleProceed, ... } = useDbConnectionForm(onSuccess, onStatusChange);

    useImperativeHandle(ref, () => ({
      proceed: handleProceed,
    }), [handleProceed]);

    return ( ... );
  }
);
```

Cuando el usuario hace clic en el botón **"Continuar"** en la barra inferior del `WizardOrchestrator`, el orquestador invoca la función `onNext` definida en el arreglo de pasos de la página:

```typescript
// En app/tools/db-db-sync/page.tsx
const steps: WizardStepDef[] = [
  {
    id: 1,
    title: "Configurar Base de Datos Origen (DB 1)",
    subtitle: "Ingrese las credenciales para conectar a la tabla de base de datos fuente.",
    icon: Database,
    content: (
      <DbConnectionForm
        key="db1-form"
        ref={db1FormRef}
        onSuccess={handleDb1Success}
        onStatusChange={(status) => setIsDb1Connected(status.isConnected && status.columns.length > 0)}
      />
    ),
    canProceed: isDb1Connected,
    onNext: () => db1FormRef.current?.proceed(),
  },
  ...
];
```

---

## 4. Aislamiento de Estado e Identidad de Componentes (`key`)

En herramientas que reutilizan el mismo componente en múltiples pasos (como DB vs. DB, donde el Paso 1 y el Paso 2 renderizan `<DbConnectionForm />`), React por defecto preservaría el estado interno de la instancia al cambiar `currentStep`.

Para garantizar un aislamiento total del estado:
1. **Llaves Únicas en la Página**: Se asignan propiedades `key` explícitas (`key="db1-form"` y `key="db2-form"`).
2. **Llave Dinámica en el Orquestador**: El `WizardOrchestrator` envuelve el contenido activo en `<div key={`step-content-${activeStep.id}`} className={styles.content}>`.

Esto fuerza a React a desmontar limpiamente la instancia del paso anterior y montar una completamente nueva y limpia para el nuevo paso.

---

## 5. Navegación Suave al Cambiar de Paso (`smoothScroll`)

El `WizardOrchestrator` implementa un `useEffect` que reacciona a los cambios en `currentStep`:

```typescript
const containerRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  containerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
}, [currentStep]);
```

Esto garantiza que si el usuario se desplazó hacia abajo inspeccionando tablas o columnas, al avanzar o retroceder de paso el visor vuelve suavemente a posicionar el encabezado del wizard en la parte superior de la pantalla.
