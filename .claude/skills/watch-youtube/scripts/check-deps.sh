#!/usr/bin/env bash
# Verify the system tools this skill needs are installed.
# yt-dlp + ffmpeg are SYSTEM deps (not npm) — we detect and instruct, never auto-install.
set -euo pipefail

missing=()
command -v yt-dlp >/dev/null 2>&1 || missing+=("yt-dlp")
command -v ffmpeg >/dev/null 2>&1 || missing+=("ffmpeg")

if [ "${#missing[@]}" -gt 0 ]; then
  printf 'MISSING: %s\n' "${missing[*]}"
  echo "Install with:"
  echo "  brew install ${missing[*]}"
  echo "(macOS/Homebrew; on Linux use your package manager or 'pipx install yt-dlp' + distro ffmpeg.)"
  exit 1
fi

echo "OK: yt-dlp $(yt-dlp --version 2>/dev/null) | $(ffmpeg -version 2>/dev/null | head -1)"
