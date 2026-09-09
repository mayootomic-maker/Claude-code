using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using UnityEngine;
using Object = UnityEngine.Object;

namespace GambleMenu.Core
{
    /// <summary>
    /// Writes a report of what worked, every time the game starts.
    ///
    /// It exists because "it doesn't work" and "it works" are indistinguishable from outside
    /// the game, and every guess made without this costs a round trip. The report says which
    /// bindings resolved, which input backend was detected, how many machines the game exposes
    /// and what the plugin can see of them — so one file answers what a dozen questions cannot.
    ///
    /// Written unprompted, because a diagnostic that has to be found and run is a diagnostic
    /// that arrives after the third exchange rather than the first.
    /// </summary>
    internal static class Diagnostics
    {
        public static string ReportPath => Path.Combine(ConfigStore.Root, "startup-report.txt");

        public static void WriteStartupReport(string version)
        {
            try
            {
                var sb = new StringBuilder();

                sb.AppendLine("GambleMenu startup report");
                sb.AppendLine("=========================");
                sb.AppendLine($"plugin        {version}");
                sb.AppendLine($"unity         {Application.unityVersion}");
                sb.AppendLine($"game          {Application.productName}  ({Application.companyName})");
                sb.AppendLine($"platform      {Application.platform}");
                sb.AppendLine($"input backend {InputBridge.BackendName}");
                sb.AppendLine($"open key      {Settings.MenuKey.Value} / {Settings.MenuKeyAlt.Value}");
                sb.AppendLine($"mods          {ModRegistry.All.Count} registered, {ModRegistry.EnabledCount} on");
                sb.AppendLine();

                int ok = GameBridge.All.Count(b => b.Ok);
                sb.AppendLine($"bindings      {ok} of {GameBridge.All.Count} resolved");
                sb.AppendLine();

                foreach (var b in GameBridge.All.OrderBy(x => x.Id, StringComparer.Ordinal))
                    sb.AppendLine($"  [{(b.Ok ? "ok  " : "MISS")}] {b.Id,-42} {b.Detail}");

                sb.AppendLine();
                sb.AppendLine("game assemblies");
                foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
                {
                    string name;
                    try { name = asm.GetName().Name; } catch { continue; }
                    if (name.StartsWith("Assembly-CSharp", StringComparison.Ordinal))
                    {
                        int types = 0;
                        try { types = asm.GetTypes().Length; } catch { }
                        sb.AppendLine($"  {name}  ({types} types)");
                    }
                }

                sb.AppendLine();
                DescribeSaveData(sb);

                sb.AppendLine();
                DescribeMachines(sb);

                Directory.CreateDirectory(ConfigStore.Root);
                File.WriteAllText(ReportPath, sb.ToString());
                Log.Info($"startup report written to {ReportPath}");
            }
            catch (Exception ex)
            {
                // A diagnostic that takes the plugin down with it would be worse than none.
                Log.Error($"could not write the startup report: {ex.Message}");
            }
        }

        /// <summary>
        /// Every field on SaveData, with its type.
        ///
        /// This is the section that costs nothing and saves a fortnight. Every binding here is
        /// a name written down by somebody who had the game open; anything nobody has looked at
        /// -- tickets, the wardrobe, whatever the next build adds -- has to be either guessed
        /// or asked about, and a guess that greys out is indistinguishable from a game that
        /// does not have the feature.
        ///
        /// One run of the game now answers it. The two cosmetics bindings find their fields by
        /// shape and print what they settled on; this prints everything they had to choose
        /// between, so a wrong choice can be corrected into a real name rather than argued
        /// about.
        /// </summary>
        private static void DescribeSaveData(StringBuilder sb)
        {
            sb.AppendLine("save data");

            if (!GameBridge.TSaveData.Ok)
            {
                sb.AppendLine("  SaveData did not resolve — no run or save mod can work on this build.");
                return;
            }

            var fields = Reflect.Fields(GameBridge.TSaveData.Type)
                .OrderBy(f => f.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();
            sb.AppendLine($"  {GameBridge.TSaveData.Type.FullName} — {fields.Count} field(s)");

            object live = null;
            try { live = RunState.Live; } catch { }

            foreach (var f in fields)
            {
                string value = "";
                if (live != null)
                {
                    try { value = "  = " + Reflect.Describe(f.GetValue(live)); }
                    catch (Exception ex) { value = "  = <threw: " + ex.GetType().Name + ">"; }
                }
                sb.AppendLine($"    {f.FieldType.Name,-24} {f.Name}{value}");
            }
            if (live == null)
                sb.AppendLine("  (no run loaded, so values are not shown — re-run this from inside a game for those)");
        }

        /// <summary>
        /// What the plugin can actually see of the casino.
        ///
        /// The machine mods stand or fall on GameBase resolving and having live instances, so
        /// that is reported concretely — a count, and the first few by name with their type and
        /// the interactables found on them — rather than left to be inferred from a binding row.
        /// </summary>
        private static void DescribeMachines(StringBuilder sb)
        {
            sb.AppendLine("machines");

            if (!GameBridge.TGameBase.Ok)
            {
                sb.AppendLine("  GameBase did not resolve — no machine mod can work on this build.");
                return;
            }

            Object[] machines;
            try { machines = Object.FindObjectsOfType(GameBridge.TGameBase.Type); }
            catch (Exception ex) { sb.AppendLine($"  lookup threw: {ex.Message}"); return; }

            sb.AppendLine($"  {machines.Length} live GameBase instance(s) at startup");
            if (machines.Length == 0)
            {
                sb.AppendLine("  (none yet — this is normal on the main menu; re-check in a run)");
                return;
            }

            foreach (var m in machines.Take(6))
            {
                if (!(m is Component c) || c == null) continue;

                string name = GameBridge.GbGameName.Ok ? GameBridge.GbGameName.Get(c) as string : null;
                object type = GameBridge.GbGameType.Ok ? GameBridge.GbGameType.Get(c) : null;

                sb.AppendLine($"    {c.GetType().Name,-18} name={name ?? "?"}  type={type ?? "?"}  object={c.gameObject.name}");

                if (GameBridge.TInteractable.Ok)
                {
                    try
                    {
                        var interactables = c.GetComponentsInChildren(GameBridge.TInteractable.Type, false);
                        sb.AppendLine($"      {interactables.Length} interactable(s)");
                        foreach (var i in interactables.Take(4))
                        {
                            string prompt = GameBridge.InteractableName.Ok
                                ? GameBridge.InteractableName.Invoke(i) as string
                                : null;
                            sb.AppendLine($"        {i.GetType().Name}  \"{prompt ?? "?"}\"");
                        }
                    }
                    catch (Exception ex) { sb.AppendLine($"      interactable scan threw: {ex.Message}"); }
                }

                // The declared members of the concrete machine type, which is what a per-game
                // hook would need and what no amount of guessing from outside can supply.
                try
                {
                    var declared = c.GetType().GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.DeclaredOnly);
                    if (declared.Length > 0)
                    {
                        sb.AppendLine($"      own fields:");
                        foreach (var f in declared.Take(14))
                            sb.AppendLine($"        {f.FieldType.Name,-16} {f.Name}");
                    }
                }
                catch { }
            }
        }
    }
}
