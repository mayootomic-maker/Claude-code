using System;
using System.Collections.Generic;
using System.Linq;
using GambleMenu.Core;

namespace GambleMenu.Tests
{
    internal static class Program
    {
        private static int _passed;
        private static int _failed;

        private static void Check(string what, bool condition, string detail = null)
        {
            if (condition) { _passed++; return; }
            _failed++;
            Console.WriteLine($"  FAIL  {what}" + (detail == null ? "" : $"\n          {detail}"));
        }

        private static void Eq(string what, string expected, string actual)
            => Check(what, expected == actual, $"expected: {Show(expected)}\n          actual:   {Show(actual)}");

        private static void Eq(string what, long expected, long actual)
            => Check(what, expected == actual, $"expected {expected}, got {actual}");

        private static string Show(string s) => s == null ? "<null>" : "\"" + s.Replace("\n", "\\n") + "\"";

        private static int Main()
        {
            Console.WriteLine("Json");
            JsonRoundTrip();
            Console.WriteLine("JsonField");
            FieldLocate();
            FieldReplace();
            FieldRead();
            Console.WriteLine("ConfigPatch");
            ConfigPatching();

            Console.WriteLine();
            Console.WriteLine($"{_passed} passed, {_failed} failed");
            return _failed == 0 ? 0 : 1;
        }

        // --- Json -------------------------------------------------------------------

        private static void JsonRoundTrip()
        {
            var map = new Dictionary<string, string>
            {
                ["menu.key"] = "Insert",
                ["economy.infinite.value"] = "1000000000000",
                ["quoted"] = "he said \"hello\"",
                ["backslash"] = @"C:\Games\Gamble",
                ["newlines"] = "line one\nline two\r\n",
                ["tab"] = "a\tb",
                ["empty"] = "",
                ["unicode"] = "café ✓ — ½",
            };

            string text = Json.Write(map);
            var back = Json.Read(text);

            Check("round trip preserves every key", back.Count == map.Count, $"wrote {map.Count}, read {back.Count}");
            foreach (var kv in map)
                Eq($"round trip preserves {kv.Key}", kv.Value, back.TryGetValue(kv.Key, out var v) ? v : "<missing>");

            // Stable ordering keeps the config file diffable between sessions.
            string again = Json.Write(back);
            Eq("writing is deterministic", text, again);

            var empty = Json.Read("{}");
            Check("empty object reads as empty map", empty.Count == 0);

            Check("null input is tolerated", Json.Read(null).Count == 0);

            bool threw = false;
            try { Json.Read("not json"); } catch (FormatException) { threw = true; }
            Check("garbage input throws rather than returning nonsense", threw);

            threw = false;
            try { Json.Read("{\"a\": \"unterminated"); } catch (FormatException) { threw = true; }
            Check("unterminated string throws", threw);
        }

        // --- ConfigPatch ------------------------------------------------------------

        private static void ConfigPatching()
        {
            // Writing into a config the user has already built up must not lose any of it.
            const string existing =
                "{\n" +
                "  \"economy.infinite.value\": \"1000000000000\",\n" +
                "  \"menu.key\": \"Insert\",\n" +
                "  \"menu.theme\": \"Casino\",\n" +
                "  \"saves.editor.name\": \"Save_1730000000\"\n" +
                "}\n";

            string patched = Installer.ConfigPatch.Set(existing, "menu.key", "F1");

            Check("changes the requested key", patched.Contains("\"menu.key\": \"F1\""));
            Check("does not leave the old value behind", !patched.Contains("\"Insert\""));
            Check("keeps an unrelated numeric setting", patched.Contains("\"economy.infinite.value\": \"1000000000000\""));
            Check("keeps an unrelated enum setting", patched.Contains("\"menu.theme\": \"Casino\""));
            Check("keeps an unrelated string setting", patched.Contains("\"saves.editor.name\": \"Save_1730000000\""));

            int entries = patched.Split('\n').Count(l => l.Contains(":"));
            Eq("entry count is unchanged", 4, entries);

            // A first run has no file at all.
            string fresh = Installer.ConfigPatch.Set(null, "menu.key", "Home");
            Check("creates a config from nothing", fresh.Contains("\"menu.key\": \"Home\""));
            Eq("a new config has exactly one entry", 1, fresh.Split('\n').Count(l => l.Contains(":")));

            // Adding a key that was not present must not drop the ones that were.
            string added = Installer.ConfigPatch.Set(existing, "menu.key2", "Insert");
            Check("adds a new key", added.Contains("\"menu.key2\": \"Insert\""));
            Eq("adding grows the config by one", 5, added.Split('\n').Count(l => l.Contains(":")));

            // Escaped content elsewhere in the file must survive untouched.
            const string withEscapes =
                "{\n  \"dev.fieldedit.value\": \"C:\\\\Games\\\\said \\\"hi\\\"\",\n  \"menu.key\": \"Insert\"\n}\n";
            string kept = Installer.ConfigPatch.Set(withEscapes, "menu.key", "F1");
            Check("preserves escaped backslashes and quotes verbatim",
                  kept.Contains("C:\\\\Games\\\\said \\\"hi\\\""));

            // And a value arriving raw gets escaped on the way in.
            string escaped = Installer.ConfigPatch.Set(null, "k", "a\"b\\c");
            Check("escapes a raw incoming value", escaped.Contains("a\\\"b\\\\c"));
        }

        // --- JsonField --------------------------------------------------------------

        private const string Save =
            "{\n" +
            "    \"saveName\": \"Save_1730000000\",\n" +
            "    \"money\": 4200,\n" +
            "    \"prestigeMoney\": 7,\n" +
            "    \"currentQuota\": 1000,\n" +
            "    \"currentFloor\": 2,\n" +
            "    \"requiredQuotaToNextFloor\": 25000,\n" +
            "    \"successfulQuota\": 3,\n" +
            "    \"negative\": -55,\n" +
            "    \"lastField\": 9\n" +
            "}";

        private static void FieldLocate()
        {
            var r = JsonField.Locate(Save, "money", out int s, out int e);
            Check("locates a numeric field", r == JsonField.Result.Ok);
            Eq("reads the right span for money", "4200", Save.Substring(s, e - s));

            // The bug this guards against: searching for "money" landing inside
            // "prestigeMoney" and rewriting the wrong field.
            r = JsonField.Locate(Save, "money", out s, out e);
            Check("does not match a longer key ending in the same name",
                  r == JsonField.Result.Ok && Save.Substring(s, e - s) == "4200");

            r = JsonField.Locate(Save, "prestigeMoney", out s, out e);
            Eq("locates the longer key when asked for it", "7", Save.Substring(s, e - s));

            r = JsonField.Locate(Save, "saveName", out s, out e);
            Eq("locates a string value including its quotes", "\"Save_1730000000\"", Save.Substring(s, e - s));

            r = JsonField.Locate(Save, "negative", out s, out e);
            Eq("locates a negative number", "-55", Save.Substring(s, e - s));

            r = JsonField.Locate(Save, "lastField", out s, out e);
            Eq("locates the final field, which has no trailing comma", "9", Save.Substring(s, e - s));

            r = JsonField.Locate(Save, "notThere", out s, out e);
            Check("reports a missing field", r == JsonField.Result.FieldMissing);
            Check("missing field has an explanation", JsonField.Explain(r, "notThere") != null);

            r = JsonField.Locate("{\"money\"", "money", out s, out e);
            Check("reports a malformed document", r == JsonField.Result.Malformed);

            r = JsonField.Locate(null, "money", out s, out e);
            Check("null document is not a crash", r == JsonField.Result.FieldMissing);
        }

        private static void FieldReplace()
        {
            var r = JsonField.Replace(Save, "money", "999999999999", out string updated);
            Check("replace succeeds", r == JsonField.Result.Ok);
            Check("new value is present", updated.Contains("\"money\": 999999999999"));
            Check("neighbouring fields survive untouched", updated.Contains("\"prestigeMoney\": 7"));
            Check("later fields survive untouched", updated.Contains("\"successfulQuota\": 3"));
            Eq("only the value changed, byte for byte",
               Save.Replace("\"money\": 4200", "\"money\": 999999999999"), updated);

            r = JsonField.Replace(Save, "lastField", "1234", out updated);
            Check("replacing the final field keeps the closing brace",
                  r == JsonField.Result.Ok && updated.TrimEnd().EndsWith("}"));
            Check("final field took the new value", updated.Contains("\"lastField\": 1234"));

            r = JsonField.Replace(Save, "currentFloor", "4", out updated);
            Check("replacing a mid-document field keeps the comma",
                  r == JsonField.Result.Ok && updated.Contains("\"currentFloor\": 4,"));

            r = JsonField.Replace(Save, "missing", "1", out updated);
            Check("a missing field leaves the document alone", r == JsonField.Result.FieldMissing && updated == Save);

            // Compact JSON, as JsonUtility writes it without prettyPrint.
            const string compact = "{\"money\":10,\"currentFloor\":1}";
            r = JsonField.Replace(compact, "money", "50", out updated);
            Eq("handles compact json with no spaces", "{\"money\":50,\"currentFloor\":1}", updated);

            r = JsonField.Replace(compact, "currentFloor", "3", out updated);
            Eq("handles the final field of compact json", "{\"money\":10,\"currentFloor\":3}", updated);
        }

        private static void FieldRead()
        {
            Check("reads a long", JsonField.TryReadLong(Save, "money", out long m) && m == 4200);
            Check("reads a negative long", JsonField.TryReadLong(Save, "negative", out long n) && n == -55);
            Check("reads the final field", JsonField.TryReadLong(Save, "lastField", out long l) && l == 9);
            Check("refuses a non-numeric field", !JsonField.TryReadLong(Save, "saveName", out _));
            Check("refuses a missing field", !JsonField.TryReadLong(Save, "nope", out _));

            const string big = "{\"money\": 1000000000000}";
            Check("reads a trillion", JsonField.TryReadLong(big, "money", out long t) && t == 1_000_000_000_000L);
        }
    }
}
