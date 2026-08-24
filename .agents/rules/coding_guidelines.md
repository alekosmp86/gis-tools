# Coding Guidelines & Component Architecture

1. **Git Commit Policy**:
   - Do NOT run `git commit` unless explicitly instructed by the user.

2. **Atomic Component Decomposition**:
   - Keep files small, modular, and focused.
   - Extract UI elements into atomic components in `src/components/ui/` or `src/components/`.
   - Examples:
     - `Badge`: Reusable badge tag with variant styles.
     - `Header`: Main navigation bar.
     - `Footer`: Application footer.
     - `ToolCard`: Individual tool item card.
     - `SearchInput`: Reusable search box.
     - `FilterTabs`: Category filter tabs.
     - `FeatureCard`: Highlights feature card.
