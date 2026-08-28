#!/bin/bash
# Fetch the source model and build project/koenigsegg_final.blend from scratch.
#
# The master .blend (~175 MB) and the source model (~176 MB) are both too large
# for GitHub, so neither is committed. Everything needed to regenerate them is,
# and this script does it in one step.
#
#   bash project/scripts/bootstrap.sh
#
# Set KSEG_SOURCE_BLEND to use a model you already have instead of downloading:
#   KSEG_SOURCE_BLEND=/path/to/jesko.blend bash project/scripts/bootstrap.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="$ROOT/project/source"
SRC="$SRC_DIR/koenigsegg_source.blend"
mkdir -p "$SRC_DIR"

# Koenigsegg Jesko 2020, Open3DLab project 7de202a0-9d61-4005-8f99-919fbf546349,
# CC BY-NC-ND 4.0. The download page is an interstitial; the real file sits
# behind a signed /project/download/go/ link inside it, which is why this
# scrapes rather than fetching the page URL directly.
PAGE="https://open3dlab.com/project/mirror/download/75d70cf9-9bd2-422f-aadc-3398d2ec1c9a/"

if [ -n "${KSEG_SOURCE_BLEND:-}" ]; then
  echo "Using model from KSEG_SOURCE_BLEND: $KSEG_SOURCE_BLEND"
  cp "$KSEG_SOURCE_BLEND" "$SRC"
elif [ -f "$SRC" ]; then
  echo "Source model already present: $SRC"
else
  echo "Resolving the download link..."
  LINK=$(curl -sSL "$PAGE" \
    | grep -oE 'href="/project/download/go/[^"]+"' \
    | head -1 | sed 's/^href="//; s/"$//')
  if [ -z "$LINK" ]; then
    echo "Could not find the download link on the page." >&2
    echo "Download the model by hand and rerun with KSEG_SOURCE_BLEND=<path>." >&2
    exit 1
  fi
  echo "Downloading the model (~176 MB)..."
  curl -sSL -o "$SRC" "https://open3dlab.com$LINK"
fi

if ! head -c 7 "$SRC" | grep -q BLENDER; then
  echo "Downloaded file is not a .blend. Fetch it manually and rerun with" >&2
  echo "KSEG_SOURCE_BLEND=<path>." >&2
  exit 1
fi
chmod 444 "$SRC"   # the source is never written to
echo "Source model ready: $(du -h "$SRC" | cut -f1)"

# --- HDRIs --------------------------------------------------------------
# The environments are photographic. Poly Haven publishes these CC0; they are
# ~25 MB each and are fetched rather than committed.
HDRI_DIR="$ROOT/project/assets/hdri"
mkdir -p "$HDRI_DIR"
for NAME in potsdamer_platz aircraft_workshop_01; do
  DEST="$HDRI_DIR/${NAME}_4k.hdr"
  if [ -f "$DEST" ]; then
    echo "HDRI already present: $(basename "$DEST")"
    continue
  fi
  echo "Downloading HDRI $NAME (~25 MB)..."
  URL=$(curl -sSL "https://api.polyhaven.com/files/$NAME" | python3 -c "
import json,sys
h=json.load(sys.stdin).get('hdri',{})
for r in ('4k','2k','8k'):
    if r in h and 'hdr' in h[r]:
        print(h[r]['hdr']['url']); break
")
  if [ -z "$URL" ]; then
    echo "Could not resolve the download URL for $NAME." >&2
    exit 1
  fi
  curl -sSL -o "$DEST" "$URL"
  head -c 10 "$DEST" | grep -q "RADIANCE" || {
    echo "$DEST is not a Radiance HDR." >&2; exit 1; }
done

echo "Building the master scene..."
blender -b -noaudio --factory-startup -P "$ROOT/project/scripts/build_master.py"
echo
echo "Done. Next:"
echo "  SAMPLES=256 DEVICE=GPU bash project/scripts/render_all.sh"
