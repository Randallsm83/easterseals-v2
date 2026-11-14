#!/usr/bin/env bash
# Checks reward delivery in the participant runner against its documented contract.
# Works on a copy of the source tree under the XDG state directory; never writes in the repo.
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "$SKILL_DIR/../../.." && pwd)"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/formal-easterseals-v2/reward-delivery"
EVIDENCE_DIR="$STATE_DIR/evidence"
MODE="check"
SEED="$(( $(date +%s) % 2147483647 ))"
RUNS=1000
# Fixed so the broken-variant proof gives the same answer on every machine.
MUTANT_SEED=20261113

# Files whose change can alter a result. Keep in step with the coverage record in SKILL.md.
COVERED=(
  client/src/pages/Session.tsx
  client/src/stores/useSessionStore.ts
  client/src/lib/rewardSchedules.ts
  client/src/lib/useExternalInput.ts
  client/src/lib/normalizeConfig.ts
  client/src/lib/api.ts
)

usage() {
  cat <<'USAGE'
usage: check.sh [--mutants | --drift] [--source DIR] [--seed N] [--runs N]

  (no mode)     run the check on the working tree; exit 0 = no property broken beyond
                the findings recorded in SKILL.md, 1 = a property is broken, 3 = setup error
  --mutants     prove every property can fail: apply each broken variant, expect a failure
  --drift       show covered files changed since the sync commit recorded in SKILL.md
  --source DIR  check another copy of the repo (default: the repo this skill lives in)
  --seed N      replay the scenarios of an earlier run (printed in every run's output)
  --runs N      scenarios per property (default 1000)
USAGE
}

while (($# > 0)); do
  case "$1" in
    --mutants) MODE="mutants" ;;
    --drift) MODE="drift" ;;
    --source) SOURCE_DIR="$(cd "$2" && pwd)"; shift ;;
    --seed) SEED="$2"; shift ;;
    --runs) RUNS="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 3 ;;
  esac
  shift
done

if [[ ! -f "$SOURCE_DIR/client/src/pages/Session.tsx" ]]; then
  echo "setup error: $SOURCE_DIR is not an easterseals-v2 tree (client/src/pages/Session.tsx missing)" >&2
  exit 3
fi

drift_report() {
  local sync changed
  # shellcheck disable=SC2016 # the backticks are literal Markdown in SKILL.md
  sync="$(sed -n 's/^- Sync commit: `\([0-9a-f]\{40\}\)`.*/\1/p' "$SKILL_DIR/SKILL.md")"
  if [[ -z "$sync" ]]; then
    echo "drift    : setup error, no sync commit line in SKILL.md"
    return 3
  fi
  if ! git -C "$SOURCE_DIR" cat-file -e "$sync^{commit}" 2>/dev/null; then
    echo "drift    : not checked ($SOURCE_DIR has no commit $sync)"
    return 0
  fi
  changed="$(git -C "$SOURCE_DIR" diff --stat "$sync" -- "${COVERED[@]}")"
  if [[ -z "$changed" ]]; then
    echo "drift    : covered files match sync commit ${sync:0:7}"
  else
    echo "drift    : covered files differ from sync commit ${sync:0:7}; re-read them against the coverage record"
    echo "$changed"
  fi
}

if [[ "$MODE" == "drift" ]]; then
  drift_report
  exit $?
fi

if ! command -v bun >/dev/null; then
  echo "setup error: bun not found. Run 'source ~/.config/zsh/agent-env.zsh' (mise) or install bun >= 1.2 from https://bun.sh" >&2
  exit 3
fi
BUN_VERSION="$(bun --version)"
if [[ "$(printf '%s\n' 1.2.0 "$BUN_VERSION" | sort -V | head -n 1)" != "1.2.0" ]]; then
  echo "setup error: bun $BUN_VERSION is older than 1.2" >&2
  exit 3
fi

# Pinned harness dependencies, installed once per lockfile outside the repo.
DEPS_DIR="$STATE_DIR/deps-$(cksum <"$SKILL_DIR/harness/bun.lock" | cut -d ' ' -f 1)"
mkdir -p "$EVIDENCE_DIR"
if [[ ! -d "$DEPS_DIR/node_modules" ]]; then
  mkdir -p "$DEPS_DIR"
  cp "$SKILL_DIR/harness/package.json" "$SKILL_DIR/harness/bun.lock" "$DEPS_DIR/"
  if ! (cd "$DEPS_DIR" && bun install --frozen-lockfile) >"$STATE_DIR/install.log" 2>&1; then
    cat "$STATE_DIR/install.log" >&2
    rm -rf "$DEPS_DIR"
    echo "setup error: could not install the pinned harness dependencies" >&2
    exit 3
  fi
fi

WORK_DIR="$(mktemp -d "$STATE_DIR/work.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT
mkdir -p "$WORK_DIR/harness" "$WORK_DIR/client"
ln -s "$DEPS_DIR/node_modules" "$WORK_DIR/node_modules"
cp "$SKILL_DIR/harness/package.json" "$WORK_DIR/"
cp "$SKILL_DIR"/harness/*.ts "$SKILL_DIR"/harness/*.tsx "$WORK_DIR/harness/"

refresh_source() {
  rm -rf "$WORK_DIR/client/src"
  cp -R "$SOURCE_DIR/client/src" "$WORK_DIR/client/src"
}

# run_tests SEED COLLECT FINDINGS LOGFILE
run_tests() {
  (cd "$WORK_DIR" && VITE_API_URL="http://reward-delivery.invalid/api" \
    REWARD_VERIFY_SEED="$1" REWARD_VERIFY_RUNS="$RUNS" REWARD_VERIFY_COLLECT="$2" REWARD_VERIFY_FINDINGS="$3" \
    bun test --preload ./harness/setup-dom.ts harness/reward-delivery.test.tsx) >"$4" 2>&1 </dev/null
}

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$EVIDENCE_DIR/$STAMP-$MODE.log"
if HEAD_COMMIT="$(git -C "$SOURCE_DIR" rev-parse HEAD 2>/dev/null)"; then
  DIRTY="$(git -C "$SOURCE_DIR" status --short -- "${COVERED[@]}")"
  DIRTY="${DIRTY:-none of the covered files}"
else
  HEAD_COMMIT="not a git checkout"
  DIRTY="unknown"
fi
{
  echo "reward-delivery $MODE at $STAMP"
  echo "source   : $SOURCE_DIR"
  echo "commit   : $HEAD_COMMIT"
  echo "modified : $DIRTY"
  echo "bun      : $BUN_VERSION"
  drift_report || true
} | tee "$LOG"

if [[ "$MODE" == "mutants" ]]; then
  survived=0
  while IFS=$'\t' read -r id property file; do
    refresh_source
    (cd "$WORK_DIR" && bun harness/mutate.ts apply "$id") </dev/null
    run_log="$WORK_DIR/run.log"
    if run_tests "$MUTANT_SEED" 1 0 "$run_log"; then
      verdict="SURVIVED"
    elif grep -Eq "\[$property\]|\"$property\":" "$run_log"; then
      verdict="KILLED"
    else
      verdict="WRONG-PROPERTY"
    fi
    [[ "$verdict" == "KILLED" ]] || survived=$((survived + 1))
    broken="$(sed -n 's/^reward-delivery: broken properties //p' "$run_log")"
    printf '%-15s %-26s %-34s %s\n' "$verdict" "$id" "$property" "$broken" | tee -a "$LOG"
    { echo "---- $id ($file)"; cat "$run_log"; } >>"$LOG"
  done < <(cd "$WORK_DIR" && bun harness/mutate.ts list)
  echo "evidence : $LOG"
  if ((survived > 0)); then
    echo "RESULT: FAIL ($survived broken variant(s) not caught by their property)" | tee -a "$LOG"
    exit 1
  fi
  echo "RESULT: PASS (every broken variant was caught by its property)" | tee -a "$LOG"
  exit 0
fi

refresh_source
status=0

contract_log="$WORK_DIR/contract.log"
if run_tests "$SEED" 0 0 "$contract_log"; then
  echo "contract : PASS seed=$SEED runs=$RUNS $(sed -n 's/^reward-delivery: reached /reached /p' "$contract_log")" | tee -a "$LOG"
else
  status=1
  echo "contract : FAIL seed=$SEED runs=$RUNS (counterexample below)" | tee -a "$LOG"
  cat "$contract_log"
fi
{ echo "---- contract on generated sessions"; cat "$contract_log"; } >>"$LOG"

# A recorded finding keeps its own scenario failing until the code is fixed.
if grep -q '^const F1_OPEN = true;' "$SKILL_DIR/harness/reward-delivery.test.tsx"; then
  findings_log="$WORK_DIR/findings.log"
  if run_tests "$SEED" 0 1 "$findings_log"; then
    echo "finding  : F1 no longer reproduces; follow 'When a finding is fixed' in SKILL.md" | tee -a "$LOG"
  elif grep -q '^\[[a-z-]*\] \[known finding F1' "$findings_log"; then
    echo "finding  : F1 (zero-cent overlap) still reproduces, as recorded in SKILL.md" | tee -a "$LOG"
  else
    status=1
    echo "finding  : the F1 scenario failed in a new way (output below)" | tee -a "$LOG"
    cat "$findings_log"
  fi
  { echo "---- recorded findings"; cat "$findings_log"; } >>"$LOG"
else
  echo "finding  : none open" | tee -a "$LOG"
fi

echo "evidence : $LOG"
if ((status == 0)); then
  echo "RESULT: PASS (no property broken beyond the findings recorded in SKILL.md)" | tee -a "$LOG"
else
  echo "RESULT: FAIL (a property is broken; read the lines starting with [property-name])" | tee -a "$LOG"
fi
exit "$status"
