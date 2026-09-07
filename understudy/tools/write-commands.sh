#!/usr/bin/env bash
# Regenerate COMMANDS.md from core.help.Manual, which is the one source the
# in-game help and the control panel also read. A test fails if the file and
# the code disagree, so run this after changing Manual.java.
#
# The encoding flags are not decoration. In a container with no locale set,
# javac reads the em dashes in the source as the platform default and java
# writes them back as question marks — the file looks fine until the test
# compares it byte for byte with what the code actually says.
set -euo pipefail
cd "$(dirname "$0")/.."

out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

find src/main/java/dev/understudy/core -name '*.java' > "$out/srcs"
javac -encoding UTF-8 -d "$out/classes" @"$out/srcs"
cat > "$out/Gen.java" <<'JAVA'
import dev.understudy.core.help.Manual;
public class Gen { public static void main(String[] a) { System.out.print(Manual.markdown()); } }
JAVA
javac -encoding UTF-8 -cp "$out/classes" -d "$out" "$out/Gen.java"
java -Dstdout.encoding=UTF-8 -cp "$out/classes:$out" Gen > COMMANDS.md
echo "wrote COMMANDS.md"
