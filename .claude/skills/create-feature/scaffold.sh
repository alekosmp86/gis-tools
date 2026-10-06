#!/usr/bin/env bash
# Scaffolds <features-root>/<feature>/ with category subfolders, each seeded with .gitkeep.
# Usage: scaffold.sh <feature-name>
# Configuration (environment variables, with defaults):
#   AI_TOOLKIT_FEATURES_ROOT   path relative to the project root where features live (default: src/features)
#   AI_TOOLKIT_FEATURE_DIRS    space-separated category folders (default: "components hooks context constants helpers types")
set -euo pipefail

raw="${1:-}"
if [ -z "$raw" ]; then
  echo "Error: feature name required. Usage: scaffold.sh <feature-name>" >&2
  exit 1
fi

# Normalize to kebab-case: lowercase, non-alphanumerics -> hyphens, collapse/trim hyphens.
feature="$(printf '%s' "$raw" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9]+/-/g; s/-+/-/g; s/^-//; s/-$//')"

if [ -z "$feature" ]; then
  echo "Error: '$raw' normalized to an empty name." >&2
  exit 1
fi

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
features_root="${AI_TOOLKIT_FEATURES_ROOT:-src/features}"
categories="${AI_TOOLKIT_FEATURE_DIRS:-components hooks context constants helpers types}"
target="$root/$features_root/$feature"

if [ -d "$target" ]; then
  echo "Error: feature already exists at $features_root/$feature" >&2
  exit 1
fi

for cat in $categories; do
  dir="$target/$cat"
  mkdir -p "$dir"
  touch "$dir/.gitkeep"
done

echo "Created feature: $features_root/$feature"
echo "Categories: $categories"
