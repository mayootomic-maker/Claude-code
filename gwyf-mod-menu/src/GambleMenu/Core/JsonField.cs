using System;
using System.Globalization;

namespace GambleMenu.Core
{
    /// <summary>
    /// Reads and rewrites single fields inside a JSON document, as text.
    ///
    /// Deliberately free of any Unity dependency so it can be unit-tested outside the game.
    /// It is also deliberately not a parser: round-tripping a save through a deserialiser
    /// would need the game's SaveData type at compile time, and would silently drop every
    /// field this plugin has never heard of. Editing the text in place cannot lose data it
    /// never looked at.
    /// </summary>
    internal static class JsonField
    {
        public enum Result { Ok, FieldMissing, Malformed, ValueUnreadable }

        /// <summary>
        /// Finds the span of a field's value. Returns the offsets so callers can read or
        /// replace it without searching twice.
        /// </summary>
        public static Result Locate(string json, string field, out int start, out int end)
        {
            start = end = -1;
            if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(field)) return Result.FieldMissing;

            string needle = "\"" + field + "\"";
            int at = -1;
            int from = 0;

            // Match the whole key, not a substring of a longer one: searching for "money"
            // must not land on "prestigeMoney", or the wrong field gets rewritten.
            while (true)
            {
                int hit = json.IndexOf(needle, from, StringComparison.Ordinal);
                if (hit < 0) break;
                char before = hit > 0 ? json[hit - 1] : ',';
                if (before != '_' && !char.IsLetterOrDigit(before)) { at = hit; break; }
                from = hit + needle.Length;
            }
            if (at < 0) return Result.FieldMissing;

            int colon = json.IndexOf(':', at + needle.Length);
            if (colon < 0) return Result.Malformed;

            int s = colon + 1;
            while (s < json.Length && char.IsWhiteSpace(json[s])) s++;
            if (s >= json.Length) return Result.Malformed;

            int e = s;
            if (json[s] == '"')
            {
                e = s + 1;
                while (e < json.Length && json[e] != '"')
                {
                    if (json[e] == '\\') e++;
                    e++;
                }
                if (e >= json.Length) return Result.Malformed;
                e++;
            }
            else
            {
                while (e < json.Length && json[e] != ',' && json[e] != '}' && json[e] != ']' &&
                       json[e] != '\n' && json[e] != '\r')
                    e++;
                // Trailing whitespace belongs to the layout, not to the value.
                while (e > s && char.IsWhiteSpace(json[e - 1])) e--;
            }

            if (e <= s) return Result.ValueUnreadable;
            start = s;
            end = e;
            return Result.Ok;
        }

        public static Result Replace(string json, string field, string rawValue, out string updated)
        {
            updated = json;
            var result = Locate(json, field, out int start, out int end);
            if (result != Result.Ok) return result;
            updated = json.Substring(0, start) + rawValue + json.Substring(end);
            return Result.Ok;
        }

        public static bool TryReadLong(string json, string field, out long value)
        {
            value = 0;
            if (Locate(json, field, out int start, out int end) != Result.Ok) return false;
            string text = json.Substring(start, end - start).Trim('"');
            return long.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out value);
        }

        public static string Explain(Result result, string field) 
        {
            switch (result)
            {
                case Result.FieldMissing:    return $"'{field}' is not present in this save.";
                case Result.Malformed:       return $"the save is malformed around '{field}'.";
                case Result.ValueUnreadable: return $"the existing value of '{field}' could not be read.";
                default:                     return null;
            }
        }
    }
}
