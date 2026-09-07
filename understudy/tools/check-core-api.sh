#!/usr/bin/env bash
# Every core symbol the Minecraft half reaches for, checked against the compiled
# core classes.
#
# This exists because of a real break. core/ and human/ compile in this
# container and mc/ and client/ do not — there is no Minecraft here — so the
# local loop verifies the tested half and is blind to the half that calls it.
# Delete a method from Combat, leave a caller in Senses, and the tests pass, the
# probes pass, and CI is the first thing to notice, twenty minutes later.
#
# javap over the built classes answers it in a second. Not a substitute for the
# real compile: it checks names, not signatures. It catches the mistake that
# actually happened.
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
classes=${1:-/tmp/uc/main}

if [ ! -d "$classes" ]; then
  echo "no compiled core at $classes — build it first"
  exit 2
fi

missing=0
grep -rhoE "\b(Combat|Armoury|Enchanting|Progress|Lean|Worth|Sorter|Catalogue|Planner|Atlas|Timings|Blueprint|Designs|Trim|Catalog|Materials|Hologram|Agenda|Guardian|Vitals|PlayerProfile)\.[A-Za-z_][A-Za-z0-9_]*" \
    "$here/src/main/java/dev/understudy/mc" "$here/src/main/java/dev/understudy/client" \
  | sort -u \
  | while IFS=. read -r type member; do
      file=$(find "$classes" -name "$type.class" | head -1)
      [ -n "$file" ] || { echo "MISSING TYPE  $type"; continue; }
      # A nested type is a class of its own; a member shows up in javap.
      if [ -f "$(dirname "$file")/$type\$$member.class" ]; then continue; fi
      if javap -p -cp "$classes" "$(basename "$(dirname "${file#$classes/}")" | sed 's|/|.|g')" \
           >/dev/null 2>&1; then :; fi
      full=$(echo "${file#$classes/}" | sed 's|/|.|g; s|\.class$||')
      if javap -p -cp "$classes" "$full" 2>/dev/null | grep -q "[ .]$member\b"; then continue; fi
      echo "MISSING       $type.$member"
      missing=1
    done | tee /tmp/uc/api-check.txt

if grep -q MISSING /tmp/uc/api-check.txt 2>/dev/null; then
  echo
  echo "The Minecraft half calls things core does not have. CI would fail on this."
  exit 1
fi
echo "every core symbol the Minecraft half uses exists"
