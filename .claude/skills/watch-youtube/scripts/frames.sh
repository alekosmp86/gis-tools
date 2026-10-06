#!/usr/bin/env bash
# Extract still frames from a downloaded video into a snapshots dir, as committable
# documentation artifacts named 1.jpeg, 2.jpeg, 3.jpeg …
#
# Frames ACCUMULATE: each call continues numbering from the highest existing N in
# <out-dir>, so a uniform first pass and later targeted passes build up one ordered
# snapshot set (no collisions, no overwrites).
#
# Two modes:
#   Uniform (first pass — the lay of the land):
#     frames.sh <video-file> <out-dir> every <seconds>
#       e.g. frames.sh video.mp4 docs/watch-youtube/<name>/snapshots every 10
#
#   Targeted (later passes — zoom in on flagged moments):
#     frames.sh <video-file> <out-dir> at <ts> [<ts> ...]
#       ts = seconds (90) or hh:mm:ss (00:01:30). One frame per timestamp.
#
# Frames are scaled to <=1280px wide — sharp enough to read on-screen text, small
# enough to view fast and commit. Prints the total frame count on the last line.
set -euo pipefail

VIDEO="${1:?usage: frames.sh <video> <out-dir> (every <sec> | at <ts...>)}"
OUT="${2:?missing out-dir}"
MODE="${3:?missing mode: 'every' or 'at'}"
mkdir -p "$OUT"

SCALE="scale='min(1280,iw)':-2"   # cap width at 1280, keep aspect, even height

# Highest existing frame number in OUT (so passes accumulate). 0 if empty.
next_index() {
  local max=0 n base
  for f in "$OUT"/*.jpeg; do
    [ -e "$f" ] || continue
    base="$(basename "$f" .jpeg)"
    case "$base" in
      ''|*[!0-9]*) continue ;;   # skip non-numeric names
    esac
    n="$base"
    [ "$n" -gt "$max" ] && max="$n"
  done
  echo "$((max + 1))"
}

START="$(next_index)"

case "$MODE" in
  every)
    SEC="${4:?usage: ... every <seconds>}"
    TMP="$(mktemp -d "${TMPDIR:-/tmp}/yt-frames.XXXXXX")"
    # Extract to a temp dir with ffmpeg auto-numbering, then renumber into OUT
    # continuing from START (keeps the 1.jpeg, 2.jpeg … scheme + accumulation).
    ffmpeg -hide_banner -loglevel error -i "$VIDEO" \
      -vf "fps=1/${SEC},${SCALE}" -q:v 3 "$TMP/f-%05d.jpeg" 1>&2
    i="$START"
    for f in "$TMP"/f-*.jpeg; do
      [ -e "$f" ] || continue
      mv "$f" "$OUT/${i}.jpeg"
      i=$((i + 1))
    done
    rm -rf "$TMP"
    ;;
  at)
    shift 3
    [ "$#" -gt 0 ] || { echo "no timestamps given" 1>&2; exit 1; }
    i="$START"
    for TS in "$@"; do
      # -ss before -i = fast keyframe-accurate seek; one frame (-frames:v 1).
      ffmpeg -hide_banner -loglevel error -ss "$TS" -i "$VIDEO" \
        -frames:v 1 -vf "$SCALE" -q:v 3 "$OUT/${i}.jpeg" 1>&2
      i=$((i + 1))
    done
    ;;
  *)
    echo "unknown mode '$MODE' (use 'every' or 'at')" 1>&2
    exit 1
    ;;
esac

COUNT="$(find "$OUT" -maxdepth 1 -name '*.jpeg' | wc -l | tr -d ' ')"
echo "$COUNT"