#!/usr/bin/env bash
# Run the task evals in both tools, a few at a time, then the later-session case on a project the
# title-card case made. Results land in evals/results/tasks/. Needs EVAL_SONG and EVAL_SONG_DATA
# (see evals/README.md); EVAL_PROJECT is set here from the title-card runs.
#   bash evals/harness/run-tasks.sh [claude|codex|both] [extra task.ts args, e.g. --model sonnet]
set -u
cd "$(dirname "$0")/../.."
TOOLS="${1:-both}"; shift || true
[ "$TOOLS" = both ] && TOOLS="claude codex"
MAX=4   # concurrent runs: each may start a browser and render on the GPU
FIRST="cv-title-card cv-song-brief cv-vertical-explainer st-beats-json st-voiceover-no-key st-music-no-key st-asks-before-spending"

run() { bun evals/harness/task.ts --case "evals/tasks/$1" --tool "$2" "${@:3}" > "evals/results/tasks/log-$1-$2.txt" 2>&1; echo "done: $1 ($2)"; }
mkdir -p evals/results/tasks
for case in $FIRST; do
  for tool in $TOOLS; do
    while [ "$(jobs -rp | wc -l)" -ge "$MAX" ]; do wait -n; done
    run "$case" "$tool" "$@" &
  done
done
wait

# a later session in a project made earlier: the title-card run's folder, per tool
for tool in $TOOLS; do
  proj=$(ls -td evals/results/tasks/cv-title-card-"$tool"*-with-*/work 2>/dev/null | head -1)
  if [ -n "$proj" ]; then EVAL_PROJECT="$(cd "$proj" && pwd -W 2>/dev/null || pwd)" run cv-later-session-small-change "$tool" "$@" &
  else echo "skip cv-later-session-small-change ($tool): no cv-title-card run"; fi
done
wait
