using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace GambleMenu.Core
{
    /// <summary>
    /// A deliberately tiny JSON reader/writer for flat string→string maps.
    ///
    /// Every persisted value in this plugin is a string produced by an <see cref="Option"/>,
    /// so a flat map is the entire requirement. Newtonsoft is not referenced (the game ships
    /// its own copy and its presence is not guaranteed across updates) and JsonUtility cannot
    /// express dictionaries, so ~120 lines here buys independence from both.
    /// </summary>
    internal static class Json
    {
        public static string Write(IDictionary<string, string> map)
        {
            var keys = new List<string>(map.Keys);
            keys.Sort(StringComparer.Ordinal); // stable file order, so diffs stay readable

            var sb = new StringBuilder();
            sb.Append("{\n");
            for (int i = 0; i < keys.Count; i++)
            {
                sb.Append("  ");
                WriteString(sb, keys[i]);
                sb.Append(": ");
                WriteString(sb, map[keys[i]]);
                if (i < keys.Count - 1) sb.Append(',');
                sb.Append('\n');
            }
            sb.Append("}\n");
            return sb.ToString();
        }

        public static Dictionary<string, string> Read(string text)
        {
            var result = new Dictionary<string, string>(StringComparer.Ordinal);
            if (string.IsNullOrEmpty(text)) return result;

            int i = 0;
            SkipWhitespace(text, ref i);
            if (i >= text.Length || text[i] != '{')
                throw new FormatException("expected '{' at start of object");
            i++;

            while (true)
            {
                SkipWhitespace(text, ref i);
                if (i >= text.Length) throw new FormatException("unterminated object");
                if (text[i] == '}') { i++; break; }
                if (text[i] == ',') { i++; continue; }

                string key = ReadString(text, ref i);
                SkipWhitespace(text, ref i);
                if (i >= text.Length || text[i] != ':')
                    throw new FormatException($"expected ':' after key '{key}'");
                i++;
                SkipWhitespace(text, ref i);
                string value = ReadString(text, ref i);
                result[key] = value;
            }
            return result;
        }

        private static void SkipWhitespace(string s, ref int i)
        {
            while (i < s.Length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\r' || s[i] == '\n')) i++;
        }

        private static void WriteString(StringBuilder sb, string value)
        {
            sb.Append('"');
            foreach (char c in value ?? string.Empty)
            {
                switch (c)
                {
                    case '"':  sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n");  break;
                    case '\r': sb.Append("\\r");  break;
                    case '\t': sb.Append("\\t");  break;
                    default:
                        if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        private static string ReadString(string s, ref int i)
        {
            if (i >= s.Length || s[i] != '"') throw new FormatException($"expected string at offset {i}");
            i++;
            var sb = new StringBuilder();
            while (true)
            {
                if (i >= s.Length) throw new FormatException("unterminated string");
                char c = s[i++];
                if (c == '"') break;
                if (c != '\\') { sb.Append(c); continue; }

                if (i >= s.Length) throw new FormatException("unterminated escape");
                char e = s[i++];
                switch (e)
                {
                    case '"':  sb.Append('"');  break;
                    case '\\': sb.Append('\\'); break;
                    case '/':  sb.Append('/');  break;
                    case 'b':  sb.Append('\b'); break;
                    case 'f':  sb.Append('\f'); break;
                    case 'n':  sb.Append('\n'); break;
                    case 'r':  sb.Append('\r'); break;
                    case 't':  sb.Append('\t'); break;
                    case 'u':
                        if (i + 4 > s.Length) throw new FormatException("truncated \\u escape");
                        sb.Append((char)int.Parse(s.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                        i += 4;
                        break;
                    default: throw new FormatException($"unknown escape '\\{e}'");
                }
            }
            return sb.ToString();
        }
    }
}
