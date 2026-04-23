#!/usr/bin/env bash
set -euo pipefail

# Verify the phase-1a coverage floor:
#   N_end >= N_baseline - D + A
# where D and A are file counts captured at phase start and computed from git
# diff against the baseline commit.

BASELINE_FILE="${1:-.ridgeline/builds/improve/phase-1a-baseline.json}"
BASELINE_COMMIT="${BASELINE_COMMIT:-0b64c37}"

if [[ ! -f "$BASELINE_FILE" ]]; then
  echo "Baseline file not found: $BASELINE_FILE" >&2
  exit 1
fi

n_baseline=$(node -e "console.log(require('./$BASELINE_FILE').passingTests)")
d_baseline=$(node -e "console.log(require('./$BASELINE_FILE').flavourImportingTestFileCount)")

# Deleted test files in this phase (those present at baseline commit but absent now).
deleted_files=$(git diff --diff-filter=D --name-only "$BASELINE_COMMIT"...HEAD -- 'src/**/*.test.ts' 'test/**/*.test.ts' 2>/dev/null | wc -l | tr -d ' ')

# Added test files in this phase (absent at baseline, present now).
added_files=$(git diff --diff-filter=A --name-only "$BASELINE_COMMIT"...HEAD -- 'src/**/*.test.ts' 'test/**/*.test.ts' 2>/dev/null | wc -l | tr -d ' ')

# Run the test suite and extract the passing test count.
test_output=$(npx vitest run 2>&1 || true)
n_end=$(echo "$test_output" | grep -E '^\s*Tests' | tail -1 | sed -E 's/.*[^0-9]([0-9]+) passed.*/\1/')

if [[ -z "$n_end" ]]; then
  echo "Could not parse passing test count from vitest output" >&2
  echo "$test_output" | tail -20 >&2
  exit 1
fi

floor=$(( n_baseline - deleted_files + added_files ))

echo "Phase 1a coverage floor verification"
echo "  N_baseline (passing tests at phase start): $n_baseline"
echo "  D (test files deleted in this phase):     $deleted_files"
echo "  A (test files added in this phase):       $added_files"
echo "  Floor (N_baseline - D + A):               $floor"
echo "  N_end  (passing tests now):               $n_end"

if (( n_end < floor )); then
  echo "FAIL: N_end ($n_end) < floor ($floor)" >&2
  exit 1
fi

echo "PASS: N_end ($n_end) >= floor ($floor)"
