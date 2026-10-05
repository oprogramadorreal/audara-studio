#!/usr/bin/env bash
# Run the task evals in both tools, a few at a time, then the cases that start from a finished project
# (a later session, a second format) on a project the title-card case made. Results land in
# evals/results/tasks/, each run's log named like its folder: log-<case>-<tool>[-<model>]-<with|without>.txt.
# Needs EVAL_SONG and EVAL_SONG_DATA (see evals/README.md); EVAL_PROJECT is set here from the title-card runs.
#   bash evals/harness/run-tasks.sh [claude|codex|both] [extra task.ts args, e.g. --model sonnet]
#   CASES="cv-title-card cv-later-session-small-change" bash evals/harness/run-tasks.sh   (only those cases)
set -u
cd "$(dirname "$0")/../.."
TOOLS="${1:-both}"; shift || true
[ "$TOOLS" = both ] && TOOLS="claude codex"
MAX=4   # concurrent runs: each may start a browser and render on the GPU
FIRST="cv-title-card cv-song-brief cv-vertical-explainer cv-zero-asset cv-direction-rejection cv-locked-script cv-visual-direction-no-script cv-product-real-screens cv-images-offered cv-images-used cv-images-no-key st-beats-json st-voiceover-no-key st-music-no-key st-asks-before-spending"
LATER="cv-later-session-small-change cv-second-format"
CASES="${CASES:-$FIRST $LATER}"
for case in $CASES; do
  [ -f "evals/tasks/$case/case.json" ] || { echo "no case '$case' in evals/tasks/: CASES takes case folder names, e.g. CASES=\"cv-title-card cv-second-format\""; exit 1; }
done

# the arm and the model, read from the extra arguments as task.ts reads them: a --without run or another
# model's run gets its own log (of a model name, only the characters a file name can hold)
arm=with model= prev=
for a in "$@"; do
  [ "$a" = --without ] && arm=without
  [ "$prev" = --model ] && model="-${a//[^A-Za-z0-9._-]/-}"
  prev=$a
done
run() {
  local log="evals/results/tasks/log-$1-$2$model-$arm.txt"
  bun evals/harness/task.ts --case "evals/tasks/$1" --tool "$2" "${@:3}" > "$log" 2>&1; echo "done: $1 ($2); log: $log"
}
mkdir -p evals/results/tasks
for case in $CASES; do
  case " $LATER " in *" $case "*) continue ;; esac
  for tool in $TOOLS; do
    while [ "$(jobs -rp | wc -l)" -ge "$MAX" ]; do wait -n; done
    run "$case" "$tool" "$@" &
  done
done
wait

# the cases that start from a project made earlier, on the same one for both tools so they are graded on the
# same project: the latest finished cv-title-card run's folder, Claude Code's if there is one, else Codex's
# (an EVAL_PROJECT set beforehand is used instead)
later=
for case in $CASES; do case " $LATER " in *" $case "*) later="$later $case" ;; esac; done
if [ -n "$later" ]; then
  proj="${EVAL_PROJECT:-}"
  for tool in claude codex; do
    [ -n "$proj" ] && break
    done_run=$(ls -td evals/results/tasks/cv-title-card-"$tool"*-with-*/result.json 2>/dev/null | head -1)
    [ -n "$done_run" ] && proj="$(dirname "$done_run")/work"
  done
  if [ -z "$proj" ]; then echo "skip$later: no finished cv-title-card run to start from (run that case first, or set EVAL_PROJECT)"
  elif [ ! -d "$proj" ]; then echo "skip$later: EVAL_PROJECT=$proj is not a folder"
  else
    proj="$(cd "$proj" && pwd -W 2>/dev/null || pwd)"
    echo "$later: every tool starts from $proj"
    for case in $later; do
      for tool in $TOOLS; do
        while [ "$(jobs -rp | wc -l)" -ge "$MAX" ]; do wait -n; done
        EVAL_PROJECT="$proj" run "$case" "$tool" "$@" &
      done
    done
  fi
fi
wait
