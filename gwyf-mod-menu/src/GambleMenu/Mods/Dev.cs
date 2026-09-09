using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using GambleMenu.Core;
using GambleMenu.UI;
using HarmonyLib;
using UnityEngine;
using Object = UnityEngine.Object;

namespace GambleMenu.Mods
{
    internal static class Dump
    {
        private const BindingFlags Any = BindingFlags.Public | BindingFlags.NonPublic |
                                         BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;

        public static string Dir => Path.Combine(ConfigStore.Root, "dumps");

        public static bool Write(string fileName, string contents)
        {
            try
            {
                Directory.CreateDirectory(Dir);
                string path = Path.Combine(Dir, fileName);
                File.WriteAllText(path, contents);
                Notifier.Success($"Written to dumps/{fileName}");
                Log.Info($"dump written: {path}");
                return true;
            }
            catch (Exception ex)
            {
                Log.Error($"dump '{fileName}' failed: {ex}");
                Notifier.Error($"Could not write the dump: {ex.Message}");
                return false;
            }
        }

        public static void DescribeType(StringBuilder sb, Type t)
        {
            sb.Append(t.IsEnum ? "enum " : t.IsValueType ? "struct " : "class ").AppendLine(t.FullName);

            foreach (var f in t.GetFields(Any).OrderBy(f => f.Name, StringComparer.Ordinal))
                sb.Append("    ").Append(f.IsStatic ? "static " : "").Append(Pretty(f.FieldType)).Append(' ').AppendLine(f.Name);

            foreach (var p in t.GetProperties(Any).OrderBy(p => p.Name, StringComparer.Ordinal))
                sb.Append("    ").Append(Pretty(p.PropertyType)).Append(' ').Append(p.Name).AppendLine(" { get; set; }");

            foreach (var m in t.GetMethods(Any).OrderBy(m => m.Name, StringComparer.Ordinal))
            {
                if (m.IsSpecialName) continue; // property accessors, already listed above
                sb.Append("    ").Append(m.IsStatic ? "static " : "").Append(Pretty(m.ReturnType)).Append(' ')
                  .Append(m.Name).Append('(')
                  .Append(string.Join(", ", m.GetParameters().Select(x => Pretty(x.ParameterType) + " " + x.Name)))
                  .AppendLine(")");
            }
            sb.AppendLine();
        }

        private static string Pretty(Type t)
        {
            if (t == typeof(void)) return "void";
            if (t == typeof(int)) return "int";
            if (t == typeof(long)) return "long";
            if (t == typeof(float)) return "float";
            if (t == typeof(bool)) return "bool";
            if (t == typeof(string)) return "string";
            return t.Name;
        }

        /// <summary>The assemblies worth dumping: the game's own code, not Unity's or ours.</summary>
        public static IEnumerable<Assembly> GameAssemblies()
        {
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                string name;
                try { name = asm.GetName().Name; } catch { continue; }
                if (name.StartsWith("Assembly-CSharp", StringComparison.Ordinal)) yield return asm;
            }
        }
    }

    /// <summary>
    /// Writes the game's own type graph to a text file.
    ///
    /// This is the tool that closes the gap left by having no Assembly-CSharp reference: with
    /// the dump in hand, the real name of any field this menu does not yet know can be read
    /// off and driven through the field editor below, or sent back to extend the plugin.
    /// </summary>
    internal sealed class AssemblyDumper : Mod
    {
        public override string Id => "dev.dump";
        public override string Name => "Dump the game's classes";
        public override string Description => "Writes every game type, field and method to a text file you can read.";
        public override Category Cat => Category.Developer;
        public override bool IsToggle => false;
        public override string[] Tags => new[] { "dump", "reflection", "classes", "types", "discover", "assembly" };

        private StringOption _filter;

        protected override void Build()
        {
            _filter = Opt(new StringOption("dev.dump.filter", "Only types containing", "",
                "Leave blank for everything. The full dump is large.") { Placeholder = "(all types)" });

            Act("Dump game classes", () =>
            {
                var sb = new StringBuilder();
                string filter = _filter.Value?.Trim() ?? "";
                int count = 0;

                foreach (var asm in Dump.GameAssemblies())
                {
                    Type[] types;
                    // A partially-loadable assembly still yields the types that did load, and
                    // those are usually the ones being looked for.
                    try { types = asm.GetTypes(); }
                    catch (ReflectionTypeLoadException ex) { types = ex.Types.Where(t => t != null).ToArray(); }
                    catch (Exception ex) { Log.Warn($"could not read {asm.GetName().Name}: {ex.Message}"); continue; }

                    sb.AppendLine($"===== {asm.GetName().Name} ({types.Length} types) =====").AppendLine();

                    foreach (var t in types.OrderBy(t => t.FullName, StringComparer.Ordinal))
                    {
                        if (filter.Length > 0 && t.FullName.IndexOf(filter, StringComparison.OrdinalIgnoreCase) < 0) continue;
                        Dump.DescribeType(sb, t);
                        count++;
                    }
                }

                if (count == 0)
                {
                    Notifier.Warn(filter.Length > 0
                        ? $"No game type matched '{filter}'."
                        : "No game assemblies found — is this running inside the game?");
                    return;
                }
                Dump.Write("game-classes.txt", sb.ToString());
            });

            Act("Dump scene components", () =>
            {
                var sb = new StringBuilder();
                var seen = new HashSet<string>(StringComparer.Ordinal);
                try
                {
                    foreach (var mb in Object.FindObjectsOfType<MonoBehaviour>())
                    {
                        if (mb == null) continue;
                        var t = mb.GetType();
                        if (!seen.Add(t.FullName)) continue;
                        sb.AppendLine($"# on GameObject '{mb.gameObject.name}'");
                        Dump.DescribeType(sb, t);
                    }
                }
                catch (Exception ex) { Notifier.Error($"Scene sweep failed: {ex.Message}"); return; }

                if (seen.Count == 0) { Notifier.Warn("No components found — is a level loaded?"); return; }
                Dump.Write("scene-components.txt", sb.ToString());
            }, "Only the types actually alive in the loaded scene — a much shorter read.");

            Act("Dump the live run", () =>
            {
                var live = RunState.Live;
                if (live == null) { Notifier.Warn("No run is loaded."); return; }

                var sb = new StringBuilder();
                sb.AppendLine($"# live {live.GetType().FullName}").AppendLine();
                foreach (var f in Reflect.Fields(live.GetType()).OrderBy(f => f.Name, StringComparer.Ordinal))
                {
                    object value;
                    try { value = f.GetValue(live); } catch (Exception ex) { value = "<threw: " + ex.Message + ">"; }
                    sb.AppendLine($"{f.FieldType.Name,-16} {f.Name,-32} = {Reflect.Describe(value)}");
                }
                Dump.Write("live-run.txt", sb.ToString());
            }, "Every field on the run in progress, with its current value.");

            Act("Write the binding report", () =>
            {
                var sb = new StringBuilder();
                sb.AppendLine($"GambleMenu {Plugin.Version} — binding report").AppendLine();
                sb.AppendLine($"input backend: {InputBridge.BackendName}");
                sb.AppendLine($"host: {GameBridge.IsHost}   connected: {GameBridge.IsConnected}   players: {GameBridge.PlayerCount}");
                sb.AppendLine();
                foreach (var b in GameBridge.All.OrderBy(b => b.Id, StringComparer.Ordinal))
                    sb.AppendLine($"[{(b.Ok ? "ok " : "MISS")}] {b.Id,-44} {b.Detail}   ({b.Purpose})");
                Dump.Write("bindings.txt", sb.ToString());
            });

            Act("Open the dumps folder", () => Application.OpenURL("file://" + Dump.Dir), Dump.Dir);
        }
    }

    /// <summary>
    /// Reads and writes any field on any live component, by name.
    ///
    /// This is the escape hatch that keeps the menu useful past the edge of what it has
    /// bindings for: anything found in a dump can be driven here without a new build, and
    /// anything worth keeping can then become a proper mod.
    /// </summary>
    internal sealed class FieldEditor : Mod
    {
        public override string Id => "dev.fieldedit";
        public override string Name => "Live field editor";
        public override string Description => "Watch and change any field on any game object, named from a dump.";
        public override Category Cat => Category.Developer;
        public override Authority Auth => Authority.SoloOnly;
        public override string[] Tags => new[] { "field", "edit", "poke", "memory", "watch", "reflection" };

        private StringOption _typeName;
        private StringOption _fieldName;
        private StringOption _newValue;
        private BoolOption _showInHud;

        private Type _type;
        private FieldInfo _field;
        private Object _instance;
        private string _error;
        private float _nextResolve;

        protected override void Build()
        {
            _typeName = Opt(new StringOption("dev.fieldedit.type", "Class name", "",
                "As it appears in the dump, e.g. GameManager.") { Placeholder = "GameManager" });
            _fieldName = Opt(new StringOption("dev.fieldedit.field", "Field name", "",
                "The exact field name, including any leading underscore.") { Placeholder = "_timer" });
            _newValue = Opt(new StringOption("dev.fieldedit.value", "New value", "",
                "Parsed to the field's own type before it is written.") { Placeholder = "0" });
            _showInHud = Opt(new BoolOption("dev.fieldedit.hud", "Show value on screen", true));

            _typeName.Changed += Rebind;
            _fieldName.Changed += Rebind;

            Act("Read it now", () =>
            {
                if (!Resolve()) { Notifier.Error(_error); return; }
                object value = _field.GetValue(_field.IsStatic ? null : (object)_instance);
                Notifier.Info($"{_typeName.Value}.{_fieldName.Value} = {Reflect.Describe(value)}");
            });

            Act("Write the new value", () =>
            {
                if (!Resolve()) { Notifier.Error(_error); return; }
                if (!Reflect.TryParse(_field.FieldType, _newValue.Value, out object parsed))
                {
                    Notifier.Error($"'{_newValue.Value}' is not a valid {_field.FieldType.Name}.");
                    return;
                }
                try
                {
                    _field.SetValue(_field.IsStatic ? null : (object)_instance, parsed);
                    Notifier.Success($"{_typeName.Value}.{_fieldName.Value} = {_newValue.Value}");
                }
                catch (Exception ex)
                {
                    Notifier.Error($"Write refused: {ex.Message}");
                }
            }, "Writes immediately. There is no undo — this is the developer tab.", destructive: true);

            Act("List fields on this class", () =>
            {
                var t = AccessTools.TypeByName(_typeName.Value?.Trim() ?? "");
                if (t == null) { Notifier.Error($"No class called '{_typeName.Value}'."); return; }
                var names = Reflect.Fields(t).Select(f => f.Name).OrderBy(n => n, StringComparer.Ordinal).ToArray();
                if (names.Length == 0) { Notifier.Warn($"{t.Name} has no fields."); return; }

                var sb = new StringBuilder();
                sb.AppendLine($"# {t.FullName}").AppendLine();
                foreach (var f in Reflect.Fields(t).OrderBy(f => f.Name, StringComparer.Ordinal))
                    sb.AppendLine($"{f.FieldType.Name,-16} {f.Name}");
                Dump.Write($"fields-{t.Name}.txt", sb.ToString());
            });
        }

        private void Rebind()
        {
            _type = null;
            _field = null;
            _instance = null;
            _error = null;
        }

        private bool Resolve()
        {
            string typeName = _typeName.Value?.Trim() ?? "";
            string fieldName = _fieldName.Value?.Trim() ?? "";

            if (typeName.Length == 0 || fieldName.Length == 0)
            {
                _error = "Fill in both a class name and a field name.";
                return false;
            }

            if (_type == null)
            {
                _type = AccessTools.TypeByName(typeName);
                if (_type == null) { _error = $"No class called '{typeName}' is loaded."; return false; }
            }

            if (_field == null)
            {
                _field = AccessTools.Field(_type, fieldName);
                if (_field == null) { _error = $"'{typeName}' has no field '{fieldName}'."; return false; }
            }

            if (!_field.IsStatic && (_instance == null))
            {
                _instance = Object.FindObjectOfType(_type);
                if (_instance == null) { _error = $"No live instance of '{typeName}' exists right now."; return false; }
            }

            _error = null;
            return true;
        }

        protected override void OnUpdate()
        {
            if (_field != null) return;
            // Half-typed class names fail to resolve, and retrying that on every frame means
            // a FindObjectOfType sweep per frame for as long as the box has focus.
            if (Time.unscaledTime < _nextResolve) return;
            _nextResolve = Time.unscaledTime + 0.5f;
            Resolve();
        }

        protected override void OnDrawOverlay()
        {
            if (!_showInHud.Value) return;

            if (_field == null)
            {
                if (_error != null) Hud.Line($"field   {_error}");
                return;
            }
            try
            {
                object value = _field.GetValue(_field.IsStatic ? null : (object)_instance);
                Hud.Line($"{_fieldName.Value}   {Reflect.Describe(value)}");
            }
            catch (Exception ex)
            {
                Hud.Line($"field   read failed: {ex.Message}");
            }
        }
    }

    internal sealed class NetworkedObjectList : Mod
    {
        public override string Id => "dev.netobjects";
        public override string Name => "Networked object list";
        public override string Description => "Everything Mirror is syncing, written to a file with its components.";
        public override Category Cat => Category.Developer;
        public override bool IsToggle => false;
        public override string[] Tags => new[] { "mirror", "network", "objects", "sync", "list" };
        public override Binding[] Requires => new Binding[] { GameBridge.TNetworkIdent };

        protected override void Build()
        {
            Act("Dump networked objects", () =>
            {
                var sb = new StringBuilder();
                int n = 0;
                try
                {
                    foreach (var identity in Object.FindObjectsOfType(GameBridge.TNetworkIdent.Type))
                    {
                        if (!(identity is Component c) || c == null) continue;
                        sb.AppendLine($"{c.gameObject.name}  @ {c.transform.position}");
                        foreach (var comp in c.GetComponents<Component>())
                            if (comp != null) sb.AppendLine($"    {comp.GetType().FullName}");
                        sb.AppendLine();
                        n++;
                    }
                }
                catch (Exception ex) { Notifier.Error($"Sweep failed: {ex.Message}"); return; }

                if (n == 0) { Notifier.Warn("Nothing networked is in the scene — are you in a lobby?"); return; }
                Dump.Write("networked-objects.txt", sb.ToString());
            });
        }
    }
}
