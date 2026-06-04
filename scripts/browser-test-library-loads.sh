#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/browser-common.sh
source "$SCRIPT_DIR/browser-common.sh"

open_app
start_als

set_editor_fixture "test-fixtures/agda/cubical-prelude.agda"
click_button Load
wait_for_log_contains "Load finished." 45000

assert_log_contains "Load finished." "Cubical Prelude loads"
assert_log_not_matches "module not found|not in scope|library.*(not|could not|failed)|failed.*library|Could not find" "Cubical load has no lookup errors"

open_app
start_als

set_editor_fixture "test-fixtures/agda/stdlib-nat.agda"
click_button Load
wait_for_log_contains "Load finished." 180000

assert_log_contains "Load finished." "standard-library Data.Nat.Base loads"
assert_log_not_matches "module not found|not in scope|library.*(not|could not|failed)|failed.*library|Could not find" "standard-library load has no lookup errors"

echo "browser-test-library-loads: PASS"
