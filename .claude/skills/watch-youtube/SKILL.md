---
name: watch-youtube
description: Actually WATCH a YouTube video — not just read its transcript — by downloading it, sampling frames, and viewing those frames as images alongside the captions. Frames are saved as committable documentation under docs/watch-youtube/<video>/snapshots/. Use whenever the user shares a YouTube (or other yt-dlp-supported) URL and wants you to understand what is shown on screen: UI/product walkthroughs, design/UX reviews, demos, tutorials. Trigger this even if the user just pastes a video link and asks "what does this show / how does this look / summarize this".
allowed-tools: Bash Read
---

# Watch YouTube

Gives real _visual_ understanding of a video, not a transcript-only summary. The runtime
cannot ingest a raw video stream, so instead: download the video, extract still frames with
ffmpeg, and **view those frames with the `Read` tool** (frames are images — the model sees
them). Captions, when present, tell you _where_ to look so you can sample the important
moments densely.

Extracted frames are saved as **documentation artifacts** so they live next to the rest of
the research (e.g. `docs/design-system.md`) and can be committed:

```
docs/watch-youtube/<video-slug>/
├── snapshots/        1.jpeg, 2.jpeg, 3.jpeg …  (ordered, accumulate across passes)
├── captions.vtt      (when the video had subtitles)
└── info.json         (title, source url, duration, chapters)
```

Primary use here: studying **Ramp product/design walkthroughs** for the design-system
reproduction — reading real UI, spacing, color, motion, and on-screen copy off the frames.

## Dependencies

Needs `yt-dlp` and `ffmpeg` (system tools, not npm). This skill **detects and instructs**;
it never auto-installs. Run the check first:

```bash
bash "$CLAUDE_PROJECT_DIR/.claude/skills/watch-youtube/scripts/check-deps.sh"
```

If it prints `MISSING: …`, relay the `brew install …` line to the user and stop until they
confirm — do not install for them. (`place.sh` also uses `python3`, already available.)

## Workflow

1. **Check deps** (above). Stop if missing.

1b. **Check the URL for a timestamp.** A user sharing `…?t=90` / `&t=1m30s` /
`#t=45` / `&start=120` is pointing at an exact moment — the strongest possible
signal for what to capture. If present, **short-circuit**: fetch, place, grab a
_single_ frame at that second, view it, done — skip uniform sampling.

```bash
TS=$(bash "$CLAUDE_PROJECT_DIR/.claude/skills/watch-youtube/scripts/url-timestamp.sh" "<url>")
# If $TS is non-empty: after fetch + place (steps 2–3), run:
#   frames.sh "$WORK/video.mp4" "$SNAPS" at "$TS"
# then Read the one frame and synthesize. Only fall through to steps 4–6 if the
# user also wants broader context.
```

2. **Fetch** the video + captions into a scratch work dir (`$TMPDIR`, disposable):

   ```bash
   WORK=$(bash "$CLAUDE_PROJECT_DIR/.claude/skills/watch-youtube/scripts/fetch.sh" "<url>")
   ```

   `fetch.sh` prints the work dir on its last line: `video.mp4`, `*.info.json`, and
   `*.vtt` captions when available.

3. **Set up the docs folder** and copy the light artifacts (captions + trimmed info)
   into it. This prints the `snapshots/` path that `frames.sh` writes into:

   ```bash
   SNAPS=$(bash "$CLAUDE_PROJECT_DIR/.claude/skills/watch-youtube/scripts/place.sh" "$WORK")
   echo "$SNAPS"   # → docs/watch-youtube/<slug>/snapshots
   ```

4. **Read the transcript first** (if `docs/watch-youtube/<slug>/captions.vtt` exists) to
   map the video: skim for moments that matter (a new screen/flow, a menu opening, a state
   change) and note their timestamps. Also check `info.json` chapters. No captions → go
   straight to a uniform first pass.

5. **First pass — uniform frames** into `snapshots/`:

   ```bash
   bash "$CLAUDE_PROJECT_DIR/.claude/skills/watch-youtube/scripts/frames.sh" \
     "$WORK/video.mp4" "$SNAPS" every 10
   ```

   Choose the interval from `info.json` duration to land ~15–40 frames (short clip →
   `every 5`; 20-min video → `every 30`). Then **view them** — batch the `Read` calls:
   `Read "$SNAPS/1.jpeg", "$SNAPS/2.jpeg", …`.

6. **Second pass — targeted frames** at flagged timestamps (frames _accumulate_: these
   append as the next-numbered `.jpeg`s, no overwrite):

   ```bash
   bash "$CLAUDE_PROJECT_DIR/.claude/skills/watch-youtube/scripts/frames.sh" \
     "$WORK/video.mp4" "$SNAPS" at 00:01:30 00:02:05 145
   ```

   Timestamps are `hh:mm:ss` or plain seconds. `Read` the new frames.

7. **Synthesize.** Combine what the frames show with what the captions say; cite
   timestamps for visual claims ("at ~2:05 the approval drawer slides in from the right
   with a lime primary button"). Distinguish what you _saw_ from what was _narrated_.

## Notes

- **Frames are the source of truth for visuals**; the transcript is guidance/narration.
  When they disagree, trust the frames and say so.
- **Motion/timing between samples is lost** — this is frame sampling, not playback. If an
  animation matters, sample densely around it with `at`.
- The **video file is not committed** (heavy, lives in `$TMPDIR`); only `snapshots/`,
  `captions.vtt`, and `info.json` under `docs/watch-youtube/<slug>/` are documentation.
- Videos download capped at 720p — enough to read UI, small enough to be fast.
- Keep snapshot sets lean (curate — delete redundant frames before committing) so the
  docs folder stays a useful reference, not a frame dump.
- Respect content ownership: use this to _study/understand_ videos, not to redistribute
  them; committed snapshots are excerpts for documentation.
- Feed findings into `docs/design-system.md` (cite the snapshot path) so the visual
  evidence is linked from the research, not left only in chat.
