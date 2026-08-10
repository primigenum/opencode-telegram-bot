#!/usr/bin/env bash
# Run each test file in its own bun process.
#
# mock.module is process-global in bun, so two test files that mock the
# same source module would otherwise pollute each other. Running each
# file in a separate process gives each a clean module cache and clean
# mock registry. This matches the CI workflow.
#
# Usage: ./scripts/run-tests.sh [test-file-pattern]
#   Default: runs all tests/**/*.test.ts
#   With pattern: runs only matching files (grep -E pattern on the path)

set -euo pipefail

pattern="${1:-}"

overall_status=0
test_count=0
pass_count=0
fail_count=0

for f in $(find tests -name "*.test.ts" | sort); do
  if [ -n "$pattern" ] && ! echo "$f" | grep -qE "$pattern"; then
    continue
  fi
  # skip: response-streamer, edge-tts, tool-call-streamer and event-subscription-service.test use accelerateTime / fakeTimers
  # helpers that hang the process after the last test on bun (fake timer
  # heap corruption). Same skip list as CI. Verified passing when run
  # individually (bun test v1.3.14, Linux).
  if echo "$f" | grep -qE "response-streamer|edge-tts|tool-call-streamer|event-subscription-service\.test"; then
    echo "SKIP: $f (accelerateTime/useFakeTimers hang on bun)"
    continue
  fi
  test_count=$((test_count + 1))
  name=$(basename "$f" .test.ts)
  echo ""
  echo "=== $f ==="
  if timeout 300 bun test "./$f" 2>&1; then
    echo "PASS: $f"
    pass_count=$((pass_count + 1))
  else
    echo "FAILED: $f"
    fail_count=$((fail_count + 1))
    overall_status=1
  fi
done

echo ""
echo "======================================"
echo "Results: $test_count files, $pass_count pass, $fail_count fail"
echo "======================================"
exit $overall_status
