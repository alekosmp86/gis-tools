#!/usr/bin/env bash
# Parse a start timestamp out of a YouTube URL, if present.
#
# Usage: url-timestamp.sh <url>
#   Prints the timestamp in SECONDS on stdout when the URL carries one, else nothing.
#
# Recognizes the forms YouTube uses:
#   ?t=90  &t=90        (plain seconds)
#   ?t=1m30s  &t=1h2m3s (h/m/s units, any subset)
#   #t=90               (hash form)
#   &start=90           (embed form)
#
# When a timestamp is present the caller can skip uniform sampling and grab a SINGLE
# frame at that exact moment — the user pointing at a specific instant is the strongest
# possible signal for what to capture.
set -euo pipefail

URL="${1:?usage: url-timestamp.sh <url>}"

# Extract the raw value of t= / start= (query or hash), first match wins.
raw="$(printf '%s' "$URL" | sed -nE 's/.*[?&#](t|start)=([^&#]+).*/\2/p' | head -1)"
[ -n "$raw" ] || exit 0   # no timestamp → print nothing

# Pure integer seconds → done.
case "$raw" in
  ''|*[!0-9]*) : ;;               # has non-digits → parse units below
  *) echo "$raw"; exit 0 ;;
esac

# Unit form (1h2m3s / 90s / 1m). Grab each unit's number independently, then sum
# h*3600 + m*60 + s. grep -oE isolates "<n>h" / "<n>m" / "<n>s" so units don't bleed.
h="$(printf '%s' "$raw" | grep -oE '[0-9]+h' | grep -oE '[0-9]+' || true)"
m="$(printf '%s' "$raw" | grep -oE '[0-9]+m' | grep -oE '[0-9]+' || true)"
s="$(printf '%s' "$raw" | grep -oE '[0-9]+s' | grep -oE '[0-9]+' || true)"
total=$(( ${h:-0} * 3600 + ${m:-0} * 60 + ${s:-0} ))
[ "$total" -gt 0 ] && echo "$total"
