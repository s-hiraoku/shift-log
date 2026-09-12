#!/usr/bin/env bash
# Drive the home-enable-and-seed feature and write evidence.
# Requires a healthy instance from launch.sh + doctor.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"
load_state

BROWSER=(node "$SCRIPT_DIR/browser.mjs")
FEATURE_DIR="$EVIDENCE_DIR/home-enable-and-seed"
mkdir -p "$FEATURE_DIR"

echo "prove: snapshot empty home" >&2
"${BROWSER[@]}" goto /
"${BROWSER[@]}" wait --text "デフォルトオフ" --timeout-ms 20000
"${BROWSER[@]}" snapshot --path "$FEATURE_DIR/01-home-before.txt"
"${BROWSER[@]}" screenshot --path "$FEATURE_DIR/01-home-before.png"

before_timeline="$(shiftlog_api GET /v1/timeline)"
printf '%s\n' "$before_timeline" >"$FEATURE_DIR/01-timeline-before.json"

echo "prove: click 有効化してデモデータを投入" >&2
"${BROWSER[@]}" click --text "有効化してデモデータを投入"
"${BROWSER[@]}" wait --text "準備完了" --timeout-ms 20000
"${BROWSER[@]}" snapshot --path "$FEATURE_DIR/02-home-after-seed.txt"
"${BROWSER[@]}" screenshot --path "$FEATURE_DIR/02-home-after-seed.png"

echo "prove: open タイムラインへ" >&2
"${BROWSER[@]}" click --text "タイムラインへ"
"${BROWSER[@]}" wait --text "10分サマリ" --timeout-ms 20000
"${BROWSER[@]}" snapshot --path "$FEATURE_DIR/03-timeline-after-seed.txt"
"${BROWSER[@]}" screenshot --path "$FEATURE_DIR/03-timeline-after-seed.png"

after_timeline="$(shiftlog_api GET /v1/timeline)"
printf '%s\n' "$after_timeline" >"$FEATURE_DIR/03-timeline-after.json"
after_perms="$(shiftlog_api GET /v1/permissions)"
printf '%s\n' "$after_perms" >"$FEATURE_DIR/03-permissions-after.json"

python3 - "$FEATURE_DIR" "$before_timeline" "$after_timeline" "$after_perms" <<'PY'
import json, sys
feature_dir, before_raw, after_raw, perms_raw = sys.argv[1:5]
before = json.loads(before_raw)
after = json.loads(after_raw)
perms = json.loads(perms_raw)
before_n = len(before.get("items") or [])
after_n = len(after.get("items") or [])
titles = [m.get("front_matter", {}).get("title", "") for m in after.get("items") or []]
report = {
    "feature": "home-enable-and-seed",
    "entry_point": "home button 有効化してデモデータを投入",
    "timeline_count_before": before_n,
    "timeline_count_after": after_n,
    "titles_after": titles,
    "enabled": perms.get("enabled"),
    "memories_enabled": perms.get("memories_enabled"),
    "paused": perms.get("paused"),
}
open(f"{feature_dir}/proof.json", "w").write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
errors = []
if before_n != 0:
    errors.append(f"expected empty timeline before seed, got {before_n}")
if after_n < 3:
    errors.append(f"expected at least 3 memories after seed, got {after_n}")
if not any("Code / Chrome" in t for t in titles):
    errors.append(f"missing Code / Chrome — 10分サマリ in {titles}")
if not any("Terminal / Slack" in t for t in titles):
    errors.append(f"missing Terminal / Slack — 10分サマリ in {titles}")
if not any(t.startswith("Safari") for t in titles):
    errors.append(f"missing Safari — 10分サマリ in {titles}")
if perms.get("enabled") is not True or perms.get("memories_enabled") is not True:
    errors.append(f"collection not enabled: {perms}")
if perms.get("paused") is not False:
    errors.append(f"expected paused=false after seed, got {perms.get('paused')}")
if errors:
    raise SystemExit("proof failed:\n- " + "\n- ".join(errors))
print(json.dumps(report, ensure_ascii=False, indent=2))
PY

echo "prove: passed  evidence=$FEATURE_DIR" >&2
