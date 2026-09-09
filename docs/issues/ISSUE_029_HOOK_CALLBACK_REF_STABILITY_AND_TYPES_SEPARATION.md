# Issue 029: Hook Callback Ref Stability & Domain Types Separation

## 1. Problem Statement
Two architectural hygiene issues were identified in the codebase:
1. **Linter Escape Hatch in Hook**: In `src/hooks/useAutoLoadFileSource.ts`, a `// eslint-disable-next-line react-hooks/exhaustive-deps` comment was suppressing linter checks because callback props (`onLoadFile`, `onError`, `onLoadingChange`) could not be included in the `useEffect` dependency array without risking infinite re-render loops or repeated download cancellations when consumers passed unmemoized inline lambdas.
2. **Misplaced Component Props in Domain Types**: In `src/types/extensions.ts`, an interface named `FileSourceExtensionRenderProps` was declared at the root domain types level. According to repository conventions, `*Props` interfaces belong in component `.tsx` files rather than domain contract definitions, and `FileSourceTabExtension.renderSelector` is a render slot context parameter rather than a standalone component.

## 2. Root Cause Analysis & Technical Details
- **Unstable Callback Prop References in React**: Callers of `useAutoLoadFileSource` (such as `CsvUploader.tsx` and `ShapefileUploader.tsx`) pass callback functions created inline in their render functions (e.g. `onLoadFile: (file) => processFile(file)`). If these callbacks are placed directly into `useEffect` dependencies, any parent re-render creates new function references, re-triggering the asynchronous auto-loader, canceling in-flight requests, and triggering cascade renders.
- **Rule Violation in Types**: The repository standard (`AGENTS.md`) explicitly dictates:
  > Component Props Exception: Component props interfaces/types (e.g. `*Props`) SHOULD be declared directly inside the `.tsx` file where the component is declared and defined.
  Declaring `FileSourceExtensionRenderProps` in `src/types/extensions.ts` blurred domain contracts with presentation-tier props naming.

## 3. Implemented Solution
1. **Latest Ref Pattern for Hook Callbacks**:
   - In `src/hooks/useAutoLoadFileSource.ts`, introduced mutable refs (`onLoadFileRef`, `onErrorRef`, `onLoadingChangeRef`) synchronized to the latest prop values via an effect:
     ```ts
     const onLoadFileRef = useRef(onLoadFile);
     const onErrorRef = useRef(onError);
     const onLoadingChangeRef = useRef(onLoadingChange);

     useEffect(() => {
       onLoadFileRef.current = onLoadFile;
       onErrorRef.current = onError;
       onLoadingChangeRef.current = onLoadingChange;
     });
     ```
   - Synchronized callbacks inside the effect execution via `onLoadFileRef.current(file)`, `onErrorRef.current(message)`, and `onLoadingChangeRef.current(status)`.
   - Safely and completely removed the `// eslint-disable-next-line react-hooks/exhaustive-deps` comment, ensuring full compliance with React Compiler and ESLint rules.
2. **Eliminated `*Props` from Domain Types**:
   - In `src/types/extensions.ts`, deleted `FileSourceExtensionRenderProps` and inlined the slot parameter context directly on `FileSourceTabExtension.renderSelector`:
     ```ts
     readonly renderSelector: (context: {
       format: SupportedExtensionFormat;
       onSelectFile: (file: File) => void;
       isLoading: boolean;
     }) => React.ReactNode;
     ```
   - Maintained 100% type inference and compatibility across all consuming components (`FileSourceSelectionArea.tsx`, `extension.tsx`, `CatalogTreeSelector.tsx`).

## 4. Code Examples & Diff Snippets

### Before (`src/hooks/useAutoLoadFileSource.ts` with linter disable comment):
```ts
        const timerId = setTimeout(() => {
          if (!isCancelled) {
            onLoadingChange(true);
            autoLoader({ sourceSlug, resourceId })
              .then((file) => {
                if (!isCancelled) {
                  onLoadFile(file);
                }
              })
              .catch((error: unknown) => {
                if (!isCancelled) {
                  onLoadingChange(false);
                  onError(message);
                }
              });
          }
        }, 0);
        // ...
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensions, sourceSlug, resourceId, hasData]);
```

### After (`src/hooks/useAutoLoadFileSource.ts` with Latest Ref pattern):
```ts
  const onLoadFileRef = useRef(onLoadFile);
  const onErrorRef = useRef(onError);
  const onLoadingChangeRef = useRef(onLoadingChange);

  useEffect(() => {
    onLoadFileRef.current = onLoadFile;
    onErrorRef.current = onError;
    onLoadingChangeRef.current = onLoadingChange;
  });

  useEffect(() => {
    let isCancelled = false;
    // ...
    onLoadingChangeRef.current(true);
    autoLoader({ sourceSlug, resourceId })
      .then((file) => {
        if (!isCancelled) {
          onLoadFileRef.current(file);
        }
      })
      .catch((error: unknown) => {
        if (!isCancelled) {
          onLoadingChangeRef.current(false);
          onErrorRef.current(message);
        }
      });
  }, [extensions, sourceSlug, resourceId, hasData]);
```

### Before (`src/types/extensions.ts`):
```ts
export interface FileSourceExtensionRenderProps {
  format: SupportedExtensionFormat;
  onSelectFile: (file: File) => void;
  isLoading: boolean;
}

export interface FileSourceTabExtension {
  // ...
  readonly renderSelector: (props: FileSourceExtensionRenderProps) => React.ReactNode;
}
```

### After (`src/types/extensions.ts`):
```ts
export interface FileSourceTabExtension {
  // ...
  readonly renderSelector: (context: {
    format: SupportedExtensionFormat;
    onSelectFile: (file: File) => void;
    isLoading: boolean;
  }) => React.ReactNode;
}
```

## 5. Verification & Testing
- `npm run lint`: Exited 0 with 0 errors and 0 warnings.
- `npm run doctor`: 100 / 100 Great maintainability score with 0 issues detected across 206 files.
- `npm run build`: Production Next.js Turbopack compilation completed cleanly in 5.2s with all static and dynamic routes generated.
