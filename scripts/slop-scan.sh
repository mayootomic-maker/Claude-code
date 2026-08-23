#!/usr/bin/env bash
# Mechanical slop detection for FrameDoctor.
#
# This does not decide anything. It produces evidence for `anti-slop-reviewer`, which
# triages every hit. A hit is not automatically a violation, and a clean scan is not
# automatically a PASS — no grep can see a chart wired to a constant.
#
# Exit code is always 0. This is a reporting tool, not a gate.

set -uo pipefail
# grep -P needs a UTF-8 locale or \x{} ranges above U+00FF are rejected outright.
export LC_ALL=C.UTF-8
cd "$(dirname "$0")/.." || exit 1

CS='--include=*.cs --include=*.xaml'
WEB='--include=*.ts --include=*.tsx --include=*.css --include=*.js --include=*.jsx'
EXCL='--exclude-dir=node_modules --exclude-dir=bin --exclude-dir=obj --exclude-dir=dist --exclude-dir=.git --exclude-dir=artifacts'

hits=0

section() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

scan() {
  local label="$1"; shift
  local out
  out=$(grep -rnI $EXCL "$@" src tests 2>/dev/null)
  if [[ -n "$out" ]]; then
    printf '\n-- %s\n%s\n' "$label" "$out"
    hits=$(( hits + $(printf '%s\n' "$out" | grep -c .) ))
  else
    printf -- '-- %s: clean\n' "$label"
  fi
}

printf '\033[1mFrameDoctor slop scan\033[0m — %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ---------------------------------------------------------------------------
section 'INTEGRITY (blockers — fake data, dead controls, unimplemented surface)'
# ---------------------------------------------------------------------------

# Randomness outside the one sanctioned simulation transport. Invariant 9.
scan 'randomness outside Simulation' -E 'new Random\(|Math\.random\(|Random\.Shared' \
     --exclude-dir=Simulation --exclude-dir=simulation --exclude-dir=Fixtures

scan 'NotImplementedException'        -E 'NotImplementedException|NotSupportedException\("TODO'
scan 'TODO / FIXME / HACK / XXX'      -E '\b(TODO|FIXME|HACK|XXX)\b'
scan '"coming soon" / placeholder'    -iE 'coming soon|placeholder|lorem ipsum|dummy data|sample data|for now[,.]|stub(bed)? out'
scan 'toast-only / empty handlers'    -E 'onClick=\{\(\) *=> *\{ *\}|onClick=\{\(\) *=> *(toast|alert|console)' $WEB
scan 'empty XAML click handlers'      -E 'Click="[A-Za-z_]+"' --include=*.xaml
scan 'disabled-with-a-tooltip'        -iE 'IsEnabled="False"|disabled\s*=\s*\{?true' 
scan 'console.log left in'            -E 'console\.(log|debug)\(' $WEB

# ---------------------------------------------------------------------------
section 'VISUAL PATTERNS (report with file:line; product-designer rules on them)'
# ---------------------------------------------------------------------------
scan 'gradients'                      -E 'linear-gradient|radial-gradient|conic-gradient|LinearGradientBrush|RadialGradientBrush'
scan 'glassmorphism / backdrop blur'  -E 'backdrop-filter|BlurEffect|AcrylicBrush'
scan 'decorative shadows'             -E 'box-shadow|DropShadowEffect'
scan 'large corner radii'             -E 'border-?[Rr]adius:?\s*.?(1[0-9]|[2-9][0-9])px|CornerRadius="(1[0-9]|[2-9][0-9])'
scan '!important'                     -E '!important' $WEB
scan 'emoji in product source'        -P '[\x{1F300}-\x{1FAFF}\x{2190}-\x{21FF}\x{2600}-\x{27BF}\x{FE0F}\x{2B00}-\x{2BFF}]'

# ---------------------------------------------------------------------------
section 'COPY (exact strings; each needs a replacement, not a softening)'
# ---------------------------------------------------------------------------
scan 'marketing / gaming clichés' -iE \
  'welcome back|lets get started|let'"'"'s get started|powered by ai|blazing.fast|supercharge|unleash|at your fingertips|boost your|turbo|ultra mode|pro gamer|optimi[sz]e your pc|one.click'

# ---------------------------------------------------------------------------
section 'HONESTY (metrics must not silently become zero)'
# ---------------------------------------------------------------------------
# Invariant: a missing metric renders Unavailable(reason), never 0.
scan 'possible zero-fallback on a metric' -E '\?\?\s*0(\.0)?[;,)}\s]|GetValueOrDefault\(0|\|\|\s*0[;,)}]'

printf '\n\033[1m== SUMMARY ==\033[0m\n'
printf 'total hits: %d\n' "$hits"
printf 'Triage every hit. A clean scan is not a PASS — it cannot see a chart bound to a constant.\n'
exit 0
