# Wizard Orchestrator Architecture & Step Decoupling

> **Module**: `src/components/shared/WizardOrchestrator.tsx` & `.module.css`  
> **Status**: Implemented & Production Active

---

## 1. Overview & Rationale

Previously, each child form and tool view (`DbConnectionForm`, `CsvUploader`, `ShapefileUploader`, `SuidMappingStep`, `Step4ResultsView`) managed its own hardcoded step titles (e.g., `1. Configure Connection...`) and internal back/next buttons.

This cross-cutting concern tightly coupled inner components to specific step positions, preventing them from being reused in other workflows (such as the DB vs. DB sync tool, which requires two separate DB connection form instances).

### Solution: Declarative `WizardOrchestrator` Pattern
The container component **`WizardOrchestrator`** assumes exclusive responsibility for:
1. Rendering the progress stepper bar ([`StepIndicator`](src/components/shared/StepIndicator.tsx)).
2. Wrapping the active step content inside a master glassmorphism card container.
3. Displaying unified step headers (`Step N of M` badge, title, subtitle, and Lucide icon).
4. Providing the bottom orchestration navigation footer with `Back` and `Continue` buttons.
5. Executing automatic smooth scrolling (`scrollIntoView({ behavior: "smooth" })`) to the top of the wizard on every step transition.

---

## 2. Type Definitions

```typescript
// In src/types/ui.ts
export interface WizardStepDef {
  id: number;
  title: string;
  subtitle: string;
  cardTitle?: string;
  cardSubtitle?: string;
  icon: LucideIcon;
  content: React.ReactNode;
  canProceed?: boolean;
  onNext?: () => void;
  nextLabel?: string;
  onBack?: () => void;
  backLabel?: string;
  hideFooter?: boolean;
}

// Co-located inside src/components/shared/WizardOrchestrator.tsx
export interface WizardOrchestratorProps {
  steps: WizardStepDef[];
  currentStep: number;
  onStepClick?: (stepId: number) => void;
}
```

---

## 3. Imperative Ref Pattern (`React.forwardRef`)

To keep inner forms and file uploaders 100% agnostic of their step position, components expose an imperative `proceed()` method via `React.forwardRef` and `useImperativeHandle`:

### Example: `DbConnectionForm.tsx`
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

When the user clicks **"Continue"** in the `WizardOrchestrator` bottom bar, the orchestrator triggers the `onNext` callback defined in the page step definition:

```typescript
// In app/tools/db-db-sync/page.tsx
const steps: WizardStepDef[] = [
  {
    id: 1,
    title: "Source Database (DB 1)",
    subtitle: "Credentials and Table",
    cardTitle: "Connect to Source PostgreSQL Database (DB 1)",
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

## 4. State Isolation & React `key` Identity

In tools that reuse the same component across multiple steps (such as DB vs. DB sync, where Step 1 and Step 2 both render `<DbConnectionForm />`), React would default to preserving internal instance state across step changes.

To ensure total state isolation:
1. **Explicit Keys on Page**: Distinct keys are assigned (`key="db1-form"` and `key="db2-form"`).
2. **Dynamic Key in Orchestrator**: `WizardOrchestrator` wraps active step content in `<div key={`step-content-${activeStep.id}`} className={styles.content}>`.

This forces React to unmount the previous step's instance cleanly and mount a fresh, unpolluted component instance for the new step.

---

## 5. Smooth Transition Scrolling (`smoothScroll`)

`WizardOrchestrator` uses a `useEffect` hook listening to `currentStep` changes:

```typescript
const containerRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  containerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
}, [currentStep]);
```

If the user scrolled down while inspecting tables or column lists, navigating forward or backward smoothly repositions the top of the wizard container at the top of the viewport.
