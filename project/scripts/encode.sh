#!/bin/bash
# Encode the rendered PNG sequence to output/koenigsegg_final.mp4.
# H.264, 1920x1080, 60 fps, high quality, yuv420p for broad playability.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IN="$ROOT/project/renders/final"
OUT="$ROOT/output/koenigsegg_final.mp4"
mkdir -p "$ROOT/output"

python3 "$ROOT/project/scripts/verify_frames.py"

ffmpeg -nostdin -hide_banner -y \
  -framerate 60 -start_number 1 -i "$IN/f_%04d.png" \
  -c:v libx264 -preset slow -crf 15 -pix_fmt yuv420p \
  -x264-params "keyint=120:min-keyint=60" \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -movflags +faststart -r 60 "$OUT"

ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,nb_frames \
  -show_entries format=duration,size -of default=noprint_wrappers=1 "$OUT"
echo "ENCODED $OUT"
