using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using UnityEngine;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace GambleMenu.Core
{
    /// <summary>
    /// Writes down what the game actually contains, rather than what this plugin hoped it would.
    ///
    /// Every game-specific binding in <see cref="GameBridge"/> is a name somebody wrote without
    /// the game in front of them. When one of those guesses is wrong the mod that needed it
    /// greys out, and the startup report says "GameSettings: type not found" — which confirms
    /// the guess failed but not what the right answer was. Two dozen of those is a plugin that
    /// opens and does nothing, which is exactly the report we had.
    ///
    /// This dumps the other side of that question: every type the game defines, its fields,
    /// methods and enum values; which networking library is actually present; what is in the
    /// live scene; and the fonts, colours and materials the game draws itself with. One launch
    /// produces it. After that, no binding in this plugin has to be a guess again — and the menu
    /// can be built to match the game's own palette instead of an invented one.
    ///
    /// Caps are on everything. A discovery file too large to send is no more use than none.
    /// </summary>
    internal static class Discovery
    {
        private const int MaxTypes = 4000;
        private const int MaxMembersPerType = 120;
        private const int MaxSceneObjects = 1200;
        private const int MaxHierarchyDepth = 6;
        private const int MaxColours = 60;
        private const int MaxFonts = 40;

        public static string Folder => Path.Combine(ConfigStore.Root, "discovery");
        public static string ZipPath => Path.Combine(ConfigStore.Root, "GambleMenu-discovery.zip");

        /// <summary>Set once a dump has been written this session, so the automatic one at
        /// startup does not repeat on every scene load.</summary>
        public static bool Written { get; private set; }

        public static string LastError { get; private set; }

        /// <summary>
        /// Assemblies that ship with Unity, BepInEx or .NET. Everything else is either the game
        /// or a library it chose, and both are worth reading.
        /// </summary>
        private static readonly string[] NotTheGame =
        {
            "UnityEngine", "Unity.", "UnityEditor", "System", "mscorlib", "netstandard",
            "Mono.", "BepInEx", "0Harmony", "HarmonyX", "GambleMenu", "Microsoft.",
            "Newtonsoft.Json", "ICSharpCode", "MonoMod", "Cpp2IL", "Iced",
        };

        /// <summary>
        /// A marker type per networking library, because which one the game uses decides whether
        /// a host-only mod is even possible and nothing else in the report answers it.
        /// </summary>
        private static readonly (string Type, string Library)[] NetcodeMarkers =
        {
            ("Mirror.NetworkServer",                    "Mirror"),
            ("Mirror.NetworkManager",                   "Mirror"),
            ("FishNet.InstanceFinder",                  "FishNet"),
            ("FishNet.Managing.NetworkManager",         "FishNet"),
            ("Unity.Netcode.NetworkManager",            "Netcode for GameObjects"),
            ("Photon.Pun.PhotonNetwork",                "Photon PUN"),
            ("Photon.Realtime.LoadBalancingClient",     "Photon Realtime"),
            ("Steamworks.SteamAPI",                     "Steamworks.NET"),
            ("Steamworks.SteamClient",                  "Facepunch.Steamworks"),
            ("Netick.Network",                          "Netick"),
            ("Nakama.Client",                           "Nakama"),
            ("Edgegap",                                 "Edgegap transport"),
        };

        public static void WriteAll(string version)
        {
            try
            {
                Directory.CreateDirectory(Folder);

                Write("01-overview.txt", sb => Overview(sb, version));
                Write("02-types.txt", Types);
                Write("03-scene.txt", Scene);
                Write("04-design.txt", Design);

                TryZip();
                Written = true;
                LastError = null;
                Log.Info($"discovery written to {Folder}");
            }
            catch (Exception ex)
            {
                // A diagnostic that takes the game down with it would be worse than none.
                LastError = ex.Message;
                Log.Error($"discovery failed: {ex}");
            }
        }

        private static void Write(string file, Action<StringBuilder> body)
        {
            var sb = new StringBuilder();
            try { body(sb); }
            catch (Exception ex)
            {
                // One section throwing must not cost the other three.
                sb.AppendLine();
                sb.AppendLine($"!! this section stopped early: {ex.GetType().Name}: {ex.Message}");
                Log.Warn($"discovery section {file} threw: {ex.Message}");
            }
            File.WriteAllText(Path.Combine(Folder, file), sb.ToString());
        }

        // --- 01 overview -----------------------------------------------------------

        private static void Overview(StringBuilder sb, string version)
        {
            sb.AppendLine("GambleMenu discovery — overview");
            sb.AppendLine("===============================");
            sb.AppendLine($"plugin        {version}");
            sb.AppendLine($"written       {DateTime.Now:yyyy-MM-dd HH:mm:ss}");
            sb.AppendLine($"game          {Application.productName}  ({Application.companyName})");
            sb.AppendLine($"version       {Application.version}");
            sb.AppendLine($"unity         {Application.unityVersion}");
            sb.AppendLine($"platform      {Application.platform}");
            sb.AppendLine($"runtime       {Describe(AppDomain.CurrentDomain.SetupInformation?.TargetFrameworkName)}");
            sb.AppendLine($"data path     {Application.dataPath}");
            sb.AppendLine();

            sb.AppendLine("networking");
            var found = new List<string>();
            foreach (var (type, library) in NetcodeMarkers)
            {
                Type t = null;
                try { t = HarmonyLib.AccessTools.TypeByName(type); } catch { }
                if (t == null) continue;
                found.Add(library);
                sb.AppendLine($"  present   {library,-26} ({t.FullName}, {Short(t.Assembly)})");
            }
            if (found.Count == 0)
                sb.AppendLine("  none of the known libraries matched — see the assembly list below,\n" +
                              "  the transport is something this plugin has not heard of.");
            sb.AppendLine();

            sb.AppendLine("scenes in the build");
            try
            {
                int n = SceneManager.sceneCountInBuildSettings;
                sb.AppendLine($"  {n} scene(s)");
                for (int i = 0; i < n; i++)
                    sb.AppendLine($"    {i,3}  {SceneUtility.GetScenePathByBuildIndex(i)}");
            }
            catch (Exception ex) { sb.AppendLine($"  lookup threw: {ex.Message}"); }
            sb.AppendLine();

            sb.AppendLine("scenes loaded now");
            try
            {
                for (int i = 0; i < SceneManager.sceneCount; i++)
                {
                    var s = SceneManager.GetSceneAt(i);
                    sb.AppendLine($"    {s.name,-32} buildIndex={s.buildIndex} rootObjects={s.rootCount}");
                }
            }
            catch (Exception ex) { sb.AppendLine($"  lookup threw: {ex.Message}"); }
            sb.AppendLine();

            sb.AppendLine("assemblies that are not Unity, .NET or BepInEx");
            foreach (var asm in GameAssemblies())
            {
                int types = 0;
                try { types = asm.GetTypes().Length; } catch { }
                sb.AppendLine($"  {Short(asm),-44} {types,5} type(s)");
            }
            sb.AppendLine();

            sb.AppendLine("bindings this plugin currently assumes");
            sb.AppendLine("  (a MISS here is a guess in GameBridge that 02-types.txt can correct)");
            foreach (var b in GameBridge.All.OrderBy(x => x.Id, StringComparer.Ordinal))
                sb.AppendLine($"  [{(b.Ok ? "ok  " : "MISS")}] {b.Id,-44} {b.Detail}");
        }

        // --- 02 types --------------------------------------------------------------

        private static void Types(StringBuilder sb)
        {
            sb.AppendLine("GambleMenu discovery — every type the game defines");
            sb.AppendLine("==================================================");
            sb.AppendLine();
            sb.AppendLine("Fields and methods are listed as a Harmony patch would need them:");
            sb.AppendLine("declaring type, member name, and the types either side of it. Enum");
            sb.AppendLine("values are spelled out, because a name like CasinoGameType tells you");
            sb.AppendLine("nothing and its members tell you the whole catalogue of games.");
            sb.AppendLine();

            int written = 0;
            foreach (var asm in GameAssemblies())
            {
                Type[] types;
                try { types = asm.GetTypes(); }
                catch (ReflectionTypeLoadException ex) { types = ex.Types.Where(t => t != null).ToArray(); }
                catch (Exception ex) { sb.AppendLine($"-- {Short(asm)}: {ex.Message}"); continue; }

                sb.AppendLine();
                sb.AppendLine($"================ {Short(asm)} — {types.Length} type(s) ================");

                foreach (var t in types.OrderBy(t => t.FullName, StringComparer.Ordinal))
                {
                    if (written >= MaxTypes)
                    {
                        sb.AppendLine();
                        sb.AppendLine($"-- stopped at {MaxTypes} types to keep this file sendable --");
                        return;
                    }
                    written++;
                    DescribeType(sb, t);
                }
            }
        }

        private static void DescribeType(StringBuilder sb, Type t)
        {
            sb.AppendLine();
            string kind = t.IsEnum ? "enum" : t.IsInterface ? "interface" : t.IsValueType ? "struct" : "class";
            string bas = t.BaseType != null && t.BaseType != typeof(object) ? " : " + Name(t.BaseType) : "";
            sb.AppendLine($"{kind} {t.FullName}{bas}");

            if (t.IsEnum)
            {
                try
                {
                    foreach (var name in Enum.GetNames(t))
                        sb.AppendLine($"    {Convert.ToInt64(Enum.Parse(t, name)),6}  {name}");
                }
                catch (Exception ex) { sb.AppendLine($"    <values unreadable: {ex.Message}>"); }
                return;
            }

            const BindingFlags Flags = BindingFlags.Public | BindingFlags.NonPublic
                                     | BindingFlags.Instance | BindingFlags.Static
                                     | BindingFlags.DeclaredOnly;
            int shown = 0;

            try
            {
                foreach (var f in t.GetFields(Flags))
                {
                    if (++shown > MaxMembersPerType) { sb.AppendLine("    ..."); return; }
                    sb.AppendLine($"    field   {Name(f.FieldType),-28} {f.Name}{(f.IsStatic ? "   [static]" : "")}");
                }
                foreach (var p in t.GetProperties(Flags))
                {
                    if (++shown > MaxMembersPerType) { sb.AppendLine("    ..."); return; }
                    sb.AppendLine($"    prop    {Name(p.PropertyType),-28} {p.Name}");
                }
                foreach (var m in t.GetMethods(Flags))
                {
                    if (m.IsSpecialName) continue; // property accessors, already listed above
                    if (++shown > MaxMembersPerType) { sb.AppendLine("    ..."); return; }
                    string args = string.Join(", ", m.GetParameters().Select(p => Name(p.ParameterType) + " " + p.Name).ToArray());
                    sb.AppendLine($"    method  {Name(m.ReturnType),-28} {m.Name}({args}){(m.IsStatic ? "   [static]" : "")}");
                }
            }
            catch (Exception ex) { sb.AppendLine($"    <members unreadable: {ex.Message}>"); }
        }

        // --- 03 scene --------------------------------------------------------------

        private static void Scene(StringBuilder sb)
        {
            sb.AppendLine("GambleMenu discovery — the live scene");
            sb.AppendLine("=====================================");
            sb.AppendLine();
            sb.AppendLine("What exists right now, with the game's own scripts named on each object.");
            sb.AppendLine("Taken from inside a run this is the map: floors, machines and the player.");
            sb.AppendLine();

            int budget = MaxSceneObjects;
            for (int i = 0; i < SceneManager.sceneCount; i++)
            {
                var scene = SceneManager.GetSceneAt(i);
                sb.AppendLine();
                sb.AppendLine($"================ scene: {scene.name} ================");
                GameObject[] roots;
                try { roots = scene.GetRootGameObjects(); }
                catch (Exception ex) { sb.AppendLine($"  unreadable: {ex.Message}"); continue; }

                foreach (var root in roots)
                {
                    if (budget <= 0) { sb.AppendLine("  -- object budget reached --"); return; }
                    Walk(sb, root.transform, 1, ref budget);
                }
            }
        }

        private static void Walk(StringBuilder sb, Transform t, int depth, ref int budget)
        {
            if (budget-- <= 0 || depth > MaxHierarchyDepth) return;

            string pad = new string(' ', depth * 2);
            var scripts = new List<string>();
            try
            {
                foreach (var c in t.GetComponents<Component>())
                {
                    if (c == null) continue;
                    var ct = c.GetType();
                    // Unity's own components are noise here; the game's scripts are the point.
                    if (IsEngineType(ct)) continue;
                    scripts.Add(ct.Name);
                }
            }
            catch { }

            sb.AppendLine($"{pad}{t.name}{(scripts.Count > 0 ? "   [" + string.Join(", ", scripts.ToArray()) + "]" : "")}");

            for (int i = 0; i < t.childCount; i++)
            {
                if (budget <= 0) return;
                Walk(sb, t.GetChild(i), depth + 1, ref budget);
            }
        }

        // --- 04 design -------------------------------------------------------------

        /// <summary>
        /// The game's own visual vocabulary: its fonts, the colours it actually draws with, and
        /// the materials on its walls.
        ///
        /// The menu is supposed to look like it came with the game. Every palette in Theme.cs was
        /// invented, because nobody writing them had seen the game. This is how they stop being
        /// invented: the colours are counted, so the ones the game leans on come out on top.
        /// </summary>
        private static void Design(StringBuilder sb)
        {
            sb.AppendLine("GambleMenu discovery — how the game looks");
            sb.AppendLine("=========================================");
            sb.AppendLine();

            sb.AppendLine("cameras");
            try
            {
                foreach (var cam in Object.FindObjectsOfType<Camera>())
                    sb.AppendLine($"  {cam.name,-24} clear={cam.clearFlags} background={Hex(cam.backgroundColor)} fov={cam.fieldOfView:0.#}");
            }
            catch (Exception ex) { sb.AppendLine($"  threw: {ex.Message}"); }
            sb.AppendLine();

            sb.AppendLine("render settings");
            try
            {
                sb.AppendLine($"  ambient      {Hex(RenderSettings.ambientLight)}  mode={RenderSettings.ambientMode}");
                sb.AppendLine($"  fog          {(RenderSettings.fog ? Hex(RenderSettings.fogColor) : "off")}");
                if (RenderSettings.skybox != null)
                    sb.AppendLine($"  skybox       {RenderSettings.skybox.name}  shader={RenderSettings.skybox.shader?.name}");
            }
            catch (Exception ex) { sb.AppendLine($"  threw: {ex.Message}"); }
            sb.AppendLine();

            sb.AppendLine("fonts");
            try
            {
                var fonts = Resources.FindObjectsOfTypeAll<Font>()
                    .Select(f => f.name).Distinct(StringComparer.Ordinal).Take(MaxFonts);
                foreach (var f in fonts) sb.AppendLine($"  Font              {f}");

                // TextMeshPro ships as a package, so it cannot be referenced at compile time —
                // but it is what most Unity games actually set their text in.
                var tmp = HarmonyLib.AccessTools.TypeByName("TMPro.TMP_FontAsset");
                if (tmp != null)
                {
                    foreach (var o in Resources.FindObjectsOfTypeAll(tmp).Take(MaxFonts))
                        sb.AppendLine($"  TMP_FontAsset     {o.name}");
                }
            }
            catch (Exception ex) { sb.AppendLine($"  threw: {ex.Message}"); }
            sb.AppendLine();

            sb.AppendLine("canvases");
            try
            {
                foreach (var c in Object.FindObjectsOfType<Canvas>())
                    sb.AppendLine($"  {c.name,-30} mode={c.renderMode} sortOrder={c.sortingOrder} scale={c.scaleFactor:0.###}");
            }
            catch (Exception ex) { sb.AppendLine($"  threw: {ex.Message}"); }
            sb.AppendLine();

            sb.AppendLine("colours the interface actually uses, most common first");
            sb.AppendLine("  (read off every UI component in the scene that exposes a colour)");
            try
            {
                var tally = new Dictionary<string, int>(StringComparer.Ordinal);
                foreach (var comp in Object.FindObjectsOfType<Component>())
                {
                    if (comp == null) continue;
                    var ct = comp.GetType();
                    string ns = ct.Namespace ?? "";
                    if (ns != "UnityEngine.UI" && !ns.StartsWith("TMPro", StringComparison.Ordinal)) continue;

                    var prop = ct.GetProperty("color", BindingFlags.Public | BindingFlags.Instance);
                    if (prop == null || prop.PropertyType != typeof(Color)) continue;
                    try
                    {
                        string hex = Hex((Color)prop.GetValue(comp, null));
                        tally.TryGetValue(hex, out int n);
                        tally[hex] = n + 1;
                    }
                    catch { }
                }

                if (tally.Count == 0)
                    sb.AppendLine("  none found — no uGUI or TMP components in this scene yet.");
                foreach (var kv in tally.OrderByDescending(k => k.Value).Take(MaxColours))
                    sb.AppendLine($"  {kv.Key}   ×{kv.Value}");
            }
            catch (Exception ex) { sb.AppendLine($"  threw: {ex.Message}"); }
            sb.AppendLine();

            sb.AppendLine("materials and shaders on what is drawn");
            try
            {
                var seen = new Dictionary<string, string>(StringComparer.Ordinal);
                foreach (var r in Object.FindObjectsOfType<Renderer>())
                {
                    var m = r.sharedMaterial;
                    if (m == null || seen.ContainsKey(m.name)) continue;
                    string colour = m.HasProperty("_Color") ? Hex(m.color) : "-";
                    seen[m.name] = $"{m.shader?.name}   base={colour}";
                    if (seen.Count >= 60) break;
                }
                foreach (var kv in seen.OrderBy(k => k.Key, StringComparer.Ordinal))
                    sb.AppendLine($"  {kv.Key,-34} {kv.Value}");
            }
            catch (Exception ex) { sb.AppendLine($"  threw: {ex.Message}"); }
        }

        // --- packaging -------------------------------------------------------------

        /// <summary>
        /// Zips the four files into one.
        ///
        /// Kept in its own method on purpose: System.IO.Compression is not guaranteed to be in
        /// every Unity Mono profile, and a missing assembly throws when the method containing
        /// the reference is compiled, not when the call is reached. Isolated like this, a game
        /// without it loses the zip and keeps the four text files.
        /// </summary>
        private static void TryZip()
        {
            try { ZipTo(ZipPath); }
            catch (Exception ex) { Log.Warn($"could not zip the discovery files ({ex.GetType().Name}) — send the folder instead"); }
        }

        private static void ZipTo(string path)
        {
            if (File.Exists(path)) File.Delete(path);
            System.IO.Compression.ZipFile.CreateFromDirectory(Folder, path);
        }

        // --- helpers ---------------------------------------------------------------

        private static IEnumerable<Assembly> GameAssemblies()
        {
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                string name;
                try { name = asm.GetName().Name; } catch { continue; }
                bool engine = false;
                foreach (var prefix in NotTheGame)
                    if (name.StartsWith(prefix, StringComparison.Ordinal)) { engine = true; break; }
                if (!engine) yield return asm;
            }
        }

        private static bool IsEngineType(Type t)
        {
            string ns = t.Namespace ?? "";
            return ns.StartsWith("UnityEngine", StringComparison.Ordinal)
                || ns.StartsWith("TMPro", StringComparison.Ordinal)
                || ns.StartsWith("GambleMenu", StringComparison.Ordinal);
        }

        private static string Short(Assembly asm)
        {
            try { return asm.GetName().Name; } catch { return "<unnamed>"; }
        }

        private static string Name(Type t)
        {
            if (t == null) return "?";
            if (!t.IsGenericType) return t.Name;
            string args = string.Join(", ", t.GetGenericArguments().Select(Name).ToArray());
            int tick = t.Name.IndexOf('`');
            return (tick > 0 ? t.Name.Substring(0, tick) : t.Name) + "<" + args + ">";
        }

        private static string Describe(string s) => string.IsNullOrEmpty(s) ? "unknown" : s;

        private static string Hex(Color c) =>
            $"#{Mathf.RoundToInt(c.r * 255):X2}{Mathf.RoundToInt(c.g * 255):X2}{Mathf.RoundToInt(c.b * 255):X2}" +
            (c.a < 0.999f ? $" a={c.a:0.00}" : "");
    }
}
