using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;

namespace GambleMenu.Installer
{
    /// <summary>
    /// Sets one entry in the plugin's flat JSON config, leaving every other entry alone.
    ///
    /// Pure and free of file access so it can be unit-tested: this runs against a config the
    /// user may already have spent time on, and truncating it to just the one key we came to
    /// write would wipe their whole setup. That failure is silent and only noticed later,
    /// which is exactly the kind worth a test.
    /// </summary>
    internal static class ConfigPatch
    {
        private static readonly Regex Pair =
            new Regex("\"((?:[^\"\\\\]|\\\\.)*)\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"", RegexOptions.Compiled);

        public static string Set(string existingJson, string key, string value)
        {
            var entries = new List<KeyValuePair<string, string>>();

            if (!string.IsNullOrEmpty(existingJson))
            {
                foreach (Match m in Pair.Matches(existingJson))
                    entries.Add(new KeyValuePair<string, string>(m.Groups[1].Value, m.Groups[2].Value));
            }

            // Values are captured with their original escaping intact and written back
            // verbatim, so a Windows path or an embedded quote survives untouched. Nothing
            // here decodes them, which is precisely why nothing here has to re-encode them.
            entries.RemoveAll(e => e.Key == key);
            entries.Add(new KeyValuePair<string, string>(key, Escape(value)));
            entries.Sort((a, b) => string.CompareOrdinal(a.Key, b.Key));

            var sb = new StringBuilder();
            sb.Append("{\n");
            for (int i = 0; i < entries.Count; i++)
            {
                sb.Append("  \"").Append(entries[i].Key).Append("\": \"").Append(entries[i].Value).Append('"');
                if (i < entries.Count - 1) sb.Append(',');
                sb.Append('\n');
            }
            sb.Append("}\n");
            return sb.ToString();
        }

        /// <summary>Escapes only the incoming value, which is the one string here that arrives
        /// raw rather than already-escaped from the file.</summary>
        private static string Escape(string s)
        {
            if (string.IsNullOrEmpty(s)) return string.Empty;
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }
    }
}
