using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using UnityEngine;
using Object = UnityEngine.Object;

namespace GambleMenu.Core
{
    /// <summary>
    /// Finds game state by shape rather than by name.
    ///
    /// The named bindings in <see cref="GameBridge"/> cover what a shipped mod told us about.
    /// For everything else — which component actually holds the live run, where the current
    /// balance lives — the reliable question is not "what is it called" but "which object owns
    /// a field of type SaveData". Field names change between builds far more often than the
    /// type graph does, so searching by type survives updates that a name lookup would not.
    /// </summary>
    internal static class Reflect
    {
        private const BindingFlags Any = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;
        private const BindingFlags AnyStatic = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static;

        public static IEnumerable<FieldInfo> Fields(Type t) =>
            t == null ? Enumerable.Empty<FieldInfo>() : t.GetFields(Any);

        public static FieldInfo FieldOfType(Type owner, Type fieldType)
        {
            if (owner == null || fieldType == null) return null;
            foreach (var f in owner.GetFields(Any))
                if (fieldType.IsAssignableFrom(f.FieldType)) return f;
            return null;
        }

        /// <summary>
        /// Locates a live component that owns a field of the requested type.
        ///
        /// Every candidate type is tried before falling back to a scene-wide sweep, because
        /// FindObjectsOfType over MonoBehaviour on a loaded casino floor is measured in
        /// milliseconds — acceptable once, unacceptable per frame. Callers cache the result.
        /// </summary>
        public static bool FindOwnerOf(Type fieldType, out Object owner, out FieldInfo field, params TypeBinding[] preferred)
        {
            owner = null;
            field = null;
            if (fieldType == null) return false;

            foreach (var candidate in preferred)
            {
                if (candidate == null || !candidate.Ok) continue;
                var f = FieldOfType(candidate.Type, fieldType);
                if (f == null) continue;
                var instance = GameBridge.Instance(candidate);
                if (instance == null) continue;
                owner = instance;
                field = f;
                return true;
            }

            try
            {
                foreach (var mb in Object.FindObjectsOfType<MonoBehaviour>())
                {
                    if (mb == null) continue;
                    var f = FieldOfType(mb.GetType(), fieldType);
                    if (f == null) continue;
                    // A field can be declared and still be null before a run starts; an owner
                    // holding nothing is no use to the caller.
                    if (f.GetValue(mb) == null) continue;
                    owner = mb;
                    field = f;
                    return true;
                }
            }
            catch (Exception ex)
            {
                Log.Warn($"scene sweep for a {fieldType.Name} owner failed: {ex.Message}");
            }
            return false;
        }

        /// <summary>Static field or property of a type, for Mirror-style singletons.</summary>
        public static object StaticValue(Type owner, string name)
        {
            if (owner == null) return null;
            try
            {
                var p = owner.GetProperty(name, AnyStatic);
                if (p != null) return p.GetValue(null);
                var f = owner.GetField(name, AnyStatic);
                return f?.GetValue(null);
            }
            catch { return null; }
        }

        /// <summary>A short, readable rendering of any value for the developer tools.</summary>
        public static string Describe(object value)
        {
            switch (value)
            {
                case null: return "null";
                case string s: return s.Length > 80 ? "\"" + s.Substring(0, 77) + "…\"" : "\"" + s + "\"";
                case Vector3 v: return $"({v.x:0.##}, {v.y:0.##}, {v.z:0.##})";
                case Vector2 v2: return $"({v2.x:0.##}, {v2.y:0.##})";
                case Object o: return o == null ? "null (destroyed)" : o.name;
                default:
                    try
                    {
                        string text = value.ToString();
                        return text.Length > 80 ? text.Substring(0, 77) + "…" : text;
                    }
                    catch { return "<ToString threw>"; }
            }
        }

        public static bool IsNumeric(Type t) =>
            t == typeof(int) || t == typeof(long) || t == typeof(float) || t == typeof(double) ||
            t == typeof(short) || t == typeof(byte) || t == typeof(uint) || t == typeof(ulong);

        /// <summary>Parses text into the given field type. Returns false rather than throwing,
        /// so the field editor can reject input instead of tripping the mod.</summary>
        public static bool TryParse(Type t, string text, out object value)
        {
            value = null;
            try
            {
                var ci = System.Globalization.CultureInfo.InvariantCulture;
                if (t == typeof(int))    { if (!int.TryParse(text, System.Globalization.NumberStyles.Integer, ci, out int i)) return false; value = i; return true; }
                if (t == typeof(long))   { if (!long.TryParse(text, System.Globalization.NumberStyles.Integer, ci, out long l)) return false; value = l; return true; }
                if (t == typeof(float))  { if (!float.TryParse(text, System.Globalization.NumberStyles.Float, ci, out float f)) return false; value = f; return true; }
                if (t == typeof(double)) { if (!double.TryParse(text, System.Globalization.NumberStyles.Float, ci, out double d)) return false; value = d; return true; }
                if (t == typeof(bool))   { if (!bool.TryParse(text, out bool b)) return false; value = b; return true; }
                if (t == typeof(string)) { value = text; return true; }
                if (t.IsEnum)            { value = Enum.Parse(t, text, true); return true; }
                return false;
            }
            catch { return false; }
        }
    }
}
