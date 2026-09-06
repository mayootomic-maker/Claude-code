using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Mono.Cecil;

namespace GambleMenu.BindingCheck
{
    /// <summary>
    /// Checks every name this plugin reaches into the game by against the game itself.
    ///
    /// The plugin resolves game types by string at runtime, which is what lets it build
    /// without the game and survive its updates. The cost is that a typo, a renamed field or
    /// a method that never existed is invisible until someone launches the game and watches a
    /// mod grey itself out — and for most of this project's life nobody could do that. One
    /// binding in twenty-three was wrong that whole time.
    ///
    /// This closes that gap without giving up the runtime lookup. It reads the binding
    /// declarations straight out of GameBridge.cs and the reflection string literals out of
    /// the mods, then looks each one up in a real Assembly-CSharp with Cecil — no Unity, no
    /// game, no launching anything. Reading the source rather than a second copy of the list
    /// is deliberate: a checklist maintained by hand drifts, and a drifted checklist passes.
    ///
    /// Usage: BindingCheck &lt;Assembly-CSharp.dll&gt; &lt;src root&gt;
    /// </summary>
    internal static class Program
    {
        private static int Main(string[] args)
        {
            if (args.Length < 2)
            {
                Console.Error.WriteLine("usage: BindingCheck <Assembly-CSharp.dll> <src root>");
                return 2;
            }
            string dll = args[0], src = args[1];
            if (!File.Exists(dll)) { Console.Error.WriteLine($"no such assembly: {dll}"); return 2; }

            // Further assemblies may be given after the source root. Mirror, for one, ships
            // beside Assembly-CSharp rather than inside it, and the plugin binds into it.
            var types = new Dictionary<string, TypeDefinition>(StringComparer.Ordinal);
            var namespaces = new HashSet<string>(StringComparer.Ordinal);
            foreach (string path in new[] { dll }.Concat(args.Skip(2).Where(File.Exists)))
            {
                foreach (var t in AssemblyDefinition.ReadAssembly(path).MainModule.GetTypes())
                {
                    types[t.FullName] = t;
                    namespaces.Add(t.Namespace ?? "");
                    // Bindings are written the way the game's own code refers to them, which
                    // for everything outside a namespace is the bare name.
                    if (!types.ContainsKey(t.Name)) types[t.Name] = t;
                }
            }
            Known = namespaces;

            // Which assemblies the game expects beside it. Mirror's own namespace appears in
            // Assembly-CSharp too — the weaver generates a class into it — so the namespace
            // alone cannot tell "this name is wrong" from "this name lives in Mirror.dll".
            // The reference list can.
            Referenced = new HashSet<string>(
                AssemblyDefinition.ReadAssembly(dll).MainModule.AssemblyReferences.Select(r => r.Name),
                StringComparer.Ordinal);

            string bridge = File.ReadAllText(Path.Combine(src, "GambleMenu", "Core", "GameBridge.cs"));
            var report = new Report();

            var typeVars = CheckTypes(bridge, types, report);
            CheckFields(bridge, typeVars, types, report);
            CheckMethods(bridge, typeVars, types, report);
            CheckReflectionLiterals(src, types, report);

            Console.WriteLine();
            Console.WriteLine($"{report.Ok} checked, {report.Failures.Count} failed, {report.Skipped} not checkable here");
            foreach (var f in report.Failures) Console.WriteLine("  FAIL  " + f);
            return report.Failures.Count == 0 ? 0 : 1;
        }

        private static HashSet<string> Known = new HashSet<string>(StringComparer.Ordinal);
        private static HashSet<string> Referenced = new HashSet<string>(StringComparer.Ordinal);

        private sealed class Report
        {
            public int Ok;
            public int Skipped;
            public readonly List<string> Failures = new List<string>();

            public void Pass(string what, string detail)
            {
                Ok++;
                Console.WriteLine($"  ok    {what,-52} {detail}");
            }

            public void Skip(string what, string why)
            {
                Skipped++;
                Console.WriteLine($"  --    {what,-52} {why}");
            }

            public void Fail(string what, string why)
            {
                Failures.Add($"{what}: {why}");
                Console.WriteLine($"  FAIL  {what,-52} {why}");
            }
        }

        // --- GameBridge ------------------------------------------------------------

        /// <summary>Maps the C# variable a TypeBinding is stored in to the game type it names,
        /// so the field and method bindings below can say which type they belong to.</summary>
        private static Dictionary<string, string> CheckTypes(
            string bridge, Dictionary<string, TypeDefinition> types, Report report)
        {
            Console.WriteLine("types");
            var vars = new Dictionary<string, string>(StringComparer.Ordinal);

            foreach (Match m in Regex.Matches(bridge,
                @"TypeBinding\s+(\w+)\s*=\s*Add\(new TypeBinding\(""([^""]+)"""))
            {
                string variable = m.Groups[1].Value, name = m.Groups[2].Value;
                vars[variable] = name;

                if (types.TryGetValue(name, out var t)) { report.Pass(name, t.FullName); continue; }

                // A name from a namespace none of the given assemblies contains is not a
                // wrong name — it is one this run had nothing to check against. Calling that
                // a failure would train everyone to ignore the failures.
                int dot = name.IndexOf('.');
                string root = dot > 0 ? name.Substring(0, dot) : "";
                if (root.Length > 0 && Referenced.Contains(root))
                    report.Skip(name, $"not checked — lives in {root}.dll, which was not given to this run");
                else
                    report.Fail(name, "no such type");
            }
            return vars;
        }

        private static void CheckFields(
            string bridge, Dictionary<string, string> typeVars,
            Dictionary<string, TypeDefinition> types, Report report)
        {
            Console.WriteLine("fields");
            foreach (Match m in Regex.Matches(bridge,
                @"new FieldBinding\((\w+),\s*""([^""]+)"""))
            {
                string owner = m.Groups[1].Value, field = m.Groups[2].Value;
                var type = Resolve(owner, typeVars, types, field, report);
                if (type == null) continue;

                var found = Walk(type, t => t.Fields.FirstOrDefault(f => f.Name == field));
                if (found == null) report.Fail($"{typeVars[owner]}.{field}", "no such field");
                else report.Pass($"{typeVars[owner]}.{field}", found.FieldType.Name);
            }
        }

        /// <summary>
        /// Method bindings, checked the way the runtime will resolve them.
        ///
        /// Existence is not enough here. A binding that names a method with no signature
        /// resolves through Type.GetMethod, which throws AmbiguousMatchException the moment the
        /// game has two overloads of that name — and that throw is what took the whole plugin
        /// down. A checker that only asks "does a method with this name exist" answers yes to
        /// exactly that bug, so it counts the overloads and insists a binding can only match one.
        /// </summary>
        private static void CheckMethods(
            string bridge, Dictionary<string, string> typeVars,
            Dictionary<string, TypeDefinition> types, Report report)
        {
            Console.WriteLine("methods");
            foreach (Match m in Regex.Matches(bridge,
                @"new MethodBinding\((\w+),\s*""([^""]+)"",\s*(null|new\[\]\s*\{([^}]*)\})"))
            {
                string owner = m.Groups[1].Value, method = m.Groups[2].Value;
                string[] args = m.Groups[3].Value == "null"
                    ? null
                    : Regex.Matches(m.Groups[4].Value, @"""([^""]+)""")
                           .Cast<Match>().Select(x => x.Groups[1].Value).ToArray();

                var type = Resolve(owner, typeVars, types, method, report);
                if (type == null) continue;

                var overloads = Overloads(type, method);
                string what = $"{typeVars[owner]}.{method}";

                if (overloads.Count == 0) { report.Fail(what, "no such method"); continue; }

                if (args == null)
                {
                    if (overloads.Count > 1)
                    {
                        report.Fail(what, $"{overloads.Count} overloads and no signature given — " +
                                          "this throws AmbiguousMatchException at runtime: " +
                                          string.Join(" | ", overloads.Select(Signature)));
                        continue;
                    }
                    report.Pass(what, Signature(overloads[0]));
                    continue;
                }

                var fits = overloads.Where(o => Fits(o, args)).ToList();
                if (fits.Count == 0)
                {
                    report.Fail(what, $"no overload takes ({string.Join(", ", args)}) — has: " +
                                      string.Join(" | ", overloads.Select(Signature)));
                }
                else if (fits.Count > 1)
                {
                    report.Fail(what, $"({string.Join(", ", args)}) still matches {fits.Count} overloads");
                }
                else
                {
                    report.Pass(what, Signature(fits[0]));
                }
            }
        }

        /// <summary>Every method of this name on the nearest type that declares any — the same
        /// rule the runtime binding uses, so an override does not count as a second overload.</summary>
        private static List<MethodDefinition> Overloads(TypeDefinition type, string name)
        {
            for (var t = type; t != null; t = Base(t))
            {
                var found = t.Methods.Where(x => x.Name == name).ToList();
                if (found.Count > 0) return found;
            }
            return new List<MethodDefinition>();
        }

        private static TypeDefinition Base(TypeDefinition t)
        {
            if (t.BaseType == null) return null;
            try { return t.BaseType.Resolve(); } catch { return null; }
        }

        private static bool Fits(MethodDefinition m, string[] args)
        {
            if (m.Parameters.Count != args.Length) return false;
            for (int i = 0; i < args.Length; i++)
                if (m.Parameters[i].ParameterType.Name != args[i]) return false;
            return true;
        }

        private static string Signature(MethodDefinition m) =>
            $"{m.ReturnType.Name} {m.Name}({string.Join(", ", m.Parameters.Select(p => p.ParameterType.Name))})";

        private static TypeDefinition Resolve(
            string ownerVar, Dictionary<string, string> typeVars,
            Dictionary<string, TypeDefinition> types, string member, Report report)
        {
            if (!typeVars.TryGetValue(ownerVar, out var name))
            {
                report.Fail($"{ownerVar}.{member}", $"binding refers to unknown type variable '{ownerVar}'");
                return null;
            }
            if (!types.TryGetValue(name, out var type))
            {
                // The type itself already failed above; not worth a second failure.
                return null;
            }
            return type;
        }

        /// <summary>Members can be declared on a base class, so a lookup that stops at the
        /// leaf reports a false miss.</summary>
        private static T Walk<T>(TypeDefinition type, Func<TypeDefinition, T> pick) where T : class
        {
            for (var t = type; t != null; t = t.BaseType?.Resolve())
            {
                var found = pick(t);
                if (found != null) return found;
                if (t.BaseType == null) break;
                try { if (t.BaseType.Resolve() == null) break; } catch { break; }
            }
            return null;
        }

        // --- reflection string literals in the mods ---------------------------------

        /// <summary>
        /// Names reached by reflection outside GameBridge — the challenge authoring reaches a
        /// dozen fields this way. They are checked against the union of the game's types
        /// rather than one named owner, because the owner is not recoverable from the call
        /// site. That still catches the failure that actually happens, which is a name the
        /// game does not have anywhere.
        /// </summary>
        private static void CheckReflectionLiterals(
            string src, Dictionary<string, TypeDefinition> types, Report report)
        {
            string path = Path.Combine(src, "GambleMenu", "Mods", "ChallengePack.cs");
            if (!File.Exists(path)) return;
            string text = File.ReadAllText(path);

            Console.WriteLine("reflected member names (ChallengePack)");
            var names = new SortedSet<string>(StringComparer.Ordinal);
            foreach (Match m in Regex.Matches(text, @"Set\([^,]+,\s*""([^""]+)"""))
                names.Add(m.Groups[1].Value);
            foreach (Match m in Regex.Matches(text, @"AccessTools\.Field\([^,]+,\s*""([^""]+)"""))
                names.Add(m.Groups[1].Value);
            foreach (Match m in Regex.Matches(text, @"^\s*""(\w+Challenges)"",?\s*$", RegexOptions.Multiline))
                names.Add(m.Groups[1].Value);

            foreach (string name in names)
            {
                var owner = types.Values.FirstOrDefault(t => t.Fields.Any(f => f.Name == name));
                if (owner == null) report.Fail(name, "no type in the game has a field with this name");
                else report.Pass(name, $"on {owner.Name}");
            }

            Console.WriteLine("CasinoGameType values used");
            var gameType = types.TryGetValue("CasinoGameType", out var e) ? e : null;
            foreach (Match m in Regex.Matches(text, @"AddGameType\([^,]+,\s*""([^""]+)"""))
            {
                string value = m.Groups[1].Value;
                if (gameType == null) { report.Fail(value, "CasinoGameType is missing"); continue; }
                if (gameType.Fields.Any(f => f.Name == value)) report.Pass($"CasinoGameType.{value}", "present");
                else report.Fail($"CasinoGameType.{value}", "not a value of this enum");
            }
        }
    }
}
