#!/usr/bin/env bash
# Opens the Understudy panel as its own window, with no address bar — the whole
# difference between a web page and something that behaves like an application.
#
# Run /panel in Minecraft first. The mod writes the current link, token and all,
# to the file this reads: the token changes every session on purpose, so a
# bookmark would go stale and this never does.
set -u

for dir in "$HOME/.minecraft" "$HOME/Library/Application Support/minecraft" \
           "${MINECRAFT_DIR:-/nonexistent}"; do
  candidate="$dir/config/understudy/panel-url.txt"
  [ -r "$candidate" ] && link=$(head -1 "$candidate") && break
done

if [ -z "${link:-}" ]; then
  echo "Run /panel in Minecraft first — no address has been written yet."
  exit 1
fi

for browser in google-chrome chromium chromium-browser microsoft-edge brave-browser; do
  if command -v "$browser" >/dev/null 2>&1; then
    exec "$browser" --app="$link" --window-size=1400,900
  fi
done

# macOS Chrome lives somewhere the PATH does not mention.
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$chrome" ] && exec "$chrome" --app="$link" --window-size=1400,900

# No Chromium anywhere: an ordinary browser tab still works fine.
command -v xdg-open >/dev/null 2>&1 && exec xdg-open "$link"
command -v open >/dev/null 2>&1 && exec open "$link"
echo "$link"
