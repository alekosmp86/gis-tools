#!/usr/bin/env bash
# Set up the committable docs folder for a fetched video and copy the light artifacts
# (captions + trimmed metadata) into it. The heavy video file stays in the work dir.
#
# Usage: place.sh <work-dir> [docs-root]
#   work-dir  = the dir printed by fetch.sh (holds video/info.json/captions)
#   docs-root = base for docs output (default: $CLAUDE_PROJECT_DIR/docs, else ./docs)
#
# Creates:
#   <docs-root>/watch-youtube/<slug>/
#   ├── snapshots/           (empty — frames.sh fills it with 1.jpeg, 2.jpeg …)
#   ├── captions.vtt         (if the video had subtitles)
#   └── info.json            (title, id, url, duration, chapters — trimmed)
#
# <slug> = kebab-cased video title (falls back to the video id).
# Prints the snapshots dir on the last stdout line (feed it to frames.sh).
set -euo pipefail

WORK="${1:?usage: place.sh <work-dir> [docs-root]}"
DOCS_ROOT="${2:-${CLAUDE_PROJECT_DIR:-.}/docs}"

INFO="$WORK/video.info.json"
[ -f "$INFO" ] || INFO="$(find "$WORK" -maxdepth 1 -name '*.info.json' | head -1)"
[ -f "$INFO" ] || { echo "no info.json in $WORK" 1>&2; exit 1; }

# Pull title + id without assuming jq is present (python3 is available in-repo).
# Emit one field per line so spaces in the title don't get split by read.
TITLE="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("title","") or "")' "$INFO")"
VIDID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("id","") or "")' "$INFO")"

slugify() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' \
    | cut -c1-60 \
    | sed -E 's/-+$//'
}
SLUG="$(slugify "$TITLE")"
[ -n "$SLUG" ] || SLUG="$(slugify "$VIDID")"
[ -n "$SLUG" ] || SLUG="video"

DEST="$DOCS_ROOT/watch-youtube/$SLUG"
SNAPS="$DEST/snapshots"
mkdir -p "$SNAPS"

# Trimmed, human-useful metadata (not the giant raw yt-dlp json).
python3 - "$INFO" "$DEST/info.json" <<'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
d = json.load(open(src))
keep = {
    "title": d.get("title"),
    "id": d.get("id"),
    "url": d.get("webpage_url") or d.get("original_url"),
    "uploader": d.get("uploader"),
    "duration": d.get("duration"),
    "chapters": [
        {"title": c.get("title"), "start": c.get("start_time"), "end": c.get("end_time")}
        for c in (d.get("chapters") or [])
    ],
}
json.dump(keep, open(dst, "w"), indent=2, ensure_ascii=False)
PY

# Copy the first available caption track as captions.vtt (best-effort).
VTT="$(find "$WORK" -maxdepth 1 -name '*.vtt' | head -1 || true)"
if [ -n "${VTT:-}" ] && [ -f "$VTT" ]; then
  cp "$VTT" "$DEST/captions.vtt"
fi

echo "$SNAPS"