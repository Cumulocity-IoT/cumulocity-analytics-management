#!/usr/bin/env bash
# Regenerates THIRD-PARTY-LICENSES.md and fails if a dependency has no acceptable license.
#
# Installs the analytics-service requirements into a throwaway venv and scans them with
# pip-licenses, runs license-checker over the analytics-ui production dependencies, then hands both
# reports to third-party-licenses.py. The UI dependencies must be installed first (npm ci in
# analytics-ui).
#
# Usage: generate-third-party-licenses.sh
set -euo pipefail

cd "$(dirname "$0")/../.."
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

[ -d analytics-ui/node_modules ] || { echo "::error::run 'npm ci' in analytics-ui first" >&2; exit 1; }

echo "Scanning backend dependencies"
python3 -m venv "$WORK/app"
"$WORK/app/bin/pip" install -q -r analytics-service/requirements.txt
python3 -m venv "$WORK/tool"
"$WORK/tool/bin/pip" install -q pip-licenses==5.5.5
"$WORK/tool/bin/pip-licenses" --python "$WORK/app/bin/python" --format=json --from=mixed --with-system \
  --ignore-packages pip setuptools wheel --output-file "$WORK/pip.json" >/dev/null

echo "Scanning UI dependencies"
(cd analytics-ui && npx --yes license-checker-rseidelsohn@4.4.2 --production --json --out "$WORK/npm.json" >/dev/null)

python3 -I .github/scripts/third-party-licenses.py "$WORK/pip.json" "$WORK/npm.json" THIRD-PARTY-LICENSES.md
