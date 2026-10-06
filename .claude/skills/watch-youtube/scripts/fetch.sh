#!/usr/bin/env bash
# Download a YouTube video + its captions into a work dir.
#
# Usage: fetch.sh <youtube-url> [work-dir]
#   work-dir defaults to a fresh dir under $TMPDIR (path is printed on the last line).
#
# Produces, inside <work-dir>:
#   video.<ext>   — the downloaded stream (capped at 720p to keep it light + fast)
#   captions.<lang>.vtt — auto/uploaded subtitles when available (may be absent)
#   info.json     — yt-dlp metadata (title, duration, chapters)
#
# Design notes:
#   - 720p cap: enough pixels to read UI/on-screen text; avoids huge 4k downloads.
#   - We DON'T fail if captions are missing — frames are the primary signal; the
#     transcript is a bonus that guides *where* to sample.
set -euo pipefail

URL="${1:?usage: fetch.sh <youtube-url> [work-dir]}"
WORK="${2:-$(mktemp -d "${TMPDIR:-/tmp}/watch-yt.XXXXXX")}"
mkdir -p "$WORK"

# Metadata + best video<=720p (progressive or merged). Best-effort captions (en*).
yt-dlp \
  --no-playlist \
  --write-info-json \
  --write-auto-subs --write-subs --sub-langs "en.*,en" --sub-format vtt \
  -f "bestvideo[height<=720]+bestaudio/best[height<=720]/best" \
  --merge-output-format mp4 \
  -o "$WORK/video.%(ext)s" \
  "$URL" 1>&2 || {
    echo "yt-dlp failed for: $URL" 1>&2
    exit 1
  }

# Report the work dir on stdout (last line) so the caller can capture it.
echo "$WORK"