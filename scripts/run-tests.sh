#!/usr/bin/env bash
# Run the full test suite with bun's native per-file isolation.
#
# `bun test --isolate` gives each test file a fresh JavaScript global object
# in the same process: mock.module() registrations and fake-timer/system-time
# state no longer leak between files (the former was why this script used to
# spawn one `bun test` process per file; bun >= 1.4.0 resets fake timers
# between isolated files and scopes module state to the file's global).
#
# Usage: ./scripts/run-tests.sh [pattern]
#   Default: runs every tests/**/*.test.ts
#   With pattern: passes it through as a bun test filter

set -euo pipefail

pattern="${1:-}"

if [ -n "$pattern" ]; then
  exec bun test --isolate "$pattern"
fi

exec bun test --isolate
