#!/bin/bash
# One command: render the full sequence, verify it, then encode the MP4.
# Resumes automatically if interrupted -- rerun the same command.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SAMPLES="${SAMPLES:-256}"
DEVICE="${DEVICE:-GPU}"

blender -b -noaudio "$ROOT/project/koenigsegg_final.blend" \
  -P "$ROOT/project/scripts/render_final.py" -- \
  --samples "$SAMPLES" --device "$DEVICE"

bash "$ROOT/project/scripts/encode.sh"
