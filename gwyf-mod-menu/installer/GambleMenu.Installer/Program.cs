using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace GambleMenu.Installer
{
    /// <summary>
    /// Installs BepInEx and the GambleMenu plugin into a Gamble With Your Friends install.
    ///
    /// This exists because "menu never opened" is far more often a broken BepInEx setup than
    /// a broken plugin, and asking someone to unzip a pack into the right folder by hand is
    /// exactly where that goes wrong. Everything needed is embedded in this executable.
    /// </summary>
    internal static class Program
    {
        private const string GameFolderName = "Gamble With Your Friends";
        private const string SteamAppId = "3892270";

        private static int Main(string[] args)
        {
            Console.Title = "GambleMenu Installer";
            Banner();

            try
            {
                bool uninstall = args.Any(a => a.Equals("--uninstall", StringComparison.OrdinalIgnoreCase));

                string gameDir = ResolveGameDirectory(args);
                if (gameDir == null)
                {
                    Fail("No game folder was chosen, so nothing was changed.");
                    return Done(1);
                }

                Info($"Game folder:  {gameDir}");
                Console.WriteLine();

                if (uninstall) return Done(Uninstall(gameDir) ? 0 : 1);
                return Done(Install(gameDir) ? 0 : 1);
            }
            catch (Exception ex)
            {
                Fail($"Unexpected problem: {ex.Message}");
                Console.WriteLine();
                Console.WriteLine(ex);
                return Done(1);
            }
        }

        // --- install ----------------------------------------------------------------

        private static bool Install(string gameDir)
        {
            string bepinexDir = Path.Combine(gameDir, "BepInEx");
            bool alreadyHadBepInEx = Directory.Exists(Path.Combine(bepinexDir, "core"));

            if (alreadyHadBepInEx)
            {
                // Never overwrite an existing setup: a mod manager profile or another mod's
                // config lives in there, and replacing it would quietly break both.
                Info("BepInEx is already installed here — leaving it exactly as it is.");
            }
            else
            {
                Step("Installing BepInEx 5.4.23.5");
                if (!ExtractBepInEx(gameDir)) return false;
                Ok("BepInEx installed.");
            }

            Step("Installing the GambleMenu plugin");
            string pluginDir = Path.Combine(bepinexDir, "plugins", "GambleMenu");
            Directory.CreateDirectory(pluginDir);

            byte[] dll = ReadResource("GambleMenu.dll");
            if (dll == null)
            {
                Fail("This installer was built without the plugin inside it. Re-run scripts/build.sh.");
                return false;
            }

            string dllPath = Path.Combine(pluginDir, "GambleMenu.dll");
            File.WriteAllBytes(dllPath, dll);
            Ok($"Plugin written to {dllPath}");

            Console.WriteLine();
            Step("Checking the result");
            var problems = Verify(gameDir);
            if (problems.Count > 0)
            {
                foreach (var p in problems) Fail(p);
                return false;
            }

            Ok("Everything is in place.");
            Console.WriteLine();
            Highlight("  Launch the game and press  INSERT");
            Console.WriteLine();
            Console.WriteLine("  A banner saying \"GambleMenu loaded\" appears for a few seconds at startup.");
            Console.WriteLine("  If you see that banner, the plugin is running and only the key is in doubt.");
            Console.WriteLine("  If you do not, open BepInEx\\LogOutput.log and search for GambleMenu.");

            if (!alreadyHadBepInEx)
            {
                Console.WriteLine();
                Console.WriteLine("  Note: BepInEx writes its own files the first time the game runs,");
                Console.WriteLine("  so the very first launch after installing can take a little longer.");
            }
            return true;
        }

        private static bool ExtractBepInEx(string gameDir)
        {
            byte[] zip = ReadResource("BepInExPack.zip");
            if (zip == null)
            {
                Fail("This installer was built without BepInEx inside it. Re-run scripts/build.sh.");
                return false;
            }

            using (var stream = new MemoryStream(zip))
            using (var archive = new ZipArchive(stream, ZipArchiveMode.Read))
            {
                foreach (var entry in archive.Entries)
                {
                    if (entry.FullName.EndsWith("/", StringComparison.Ordinal)) continue;

                    // The Thunderstore pack nests everything under BepInExPack/; the game
                    // expects those files at its own root.
                    string relative = entry.FullName;
                    const string prefix = "BepInExPack/";
                    if (relative.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                        relative = relative.Substring(prefix.Length);
                    if (relative.Length == 0) continue;

                    // Refuse any path that would escape the game folder.
                    string target = Path.GetFullPath(Path.Combine(gameDir, relative.Replace('/', Path.DirectorySeparatorChar)));
                    if (!target.StartsWith(Path.GetFullPath(gameDir), StringComparison.OrdinalIgnoreCase))
                    {
                        Fail($"Refusing to write outside the game folder: {entry.FullName}");
                        return false;
                    }

                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    entry.ExtractToFile(target, true);
                }
            }
            return true;
        }

        private static List<string> Verify(string gameDir)
        {
            var problems = new List<string>();

            string[] required =
            {
                Path.Combine(gameDir, "winhttp.dll"),
                Path.Combine(gameDir, "BepInEx", "core", "BepInEx.dll"),
                Path.Combine(gameDir, "BepInEx", "core", "0Harmony.dll"),
                Path.Combine(gameDir, "BepInEx", "plugins", "GambleMenu", "GambleMenu.dll"),
            };

            foreach (var path in required)
                if (!File.Exists(path)) problems.Add($"Missing after install: {path}");

            if (!Directory.GetFiles(gameDir, "*.exe").Any())
                problems.Add("No .exe in the game folder — this may not be the game directory.");

            return problems;
        }

        private static bool Uninstall(string gameDir)
        {
            Step("Removing the GambleMenu plugin");
            string pluginDir = Path.Combine(gameDir, "BepInEx", "plugins", "GambleMenu");

            if (!Directory.Exists(pluginDir))
            {
                Info("It was not installed here.");
                return true;
            }

            Directory.Delete(pluginDir, true);
            Ok("Plugin removed.");
            Info("BepInEx and your settings were left alone. Settings live in BepInEx\\config\\GambleMenu.");
            return true;
        }

        // --- locating the game ------------------------------------------------------

        private static string ResolveGameDirectory(string[] args)
        {
            // 1. An explicit path always wins.
            string explicitPath = args.FirstOrDefault(a => !a.StartsWith("--", StringComparison.Ordinal));
            if (explicitPath != null)
            {
                if (LooksLikeGame(explicitPath)) return explicitPath;
                Fail($"That path does not look like the game folder: {explicitPath}");
            }

            // 2. Next to the installer, for someone who dropped it into the game folder.
            string here = AppDomain.CurrentDomain.BaseDirectory;
            if (LooksLikeGame(here))
            {
                Ok("Found the game in this folder.");
                return here.TrimEnd(Path.DirectorySeparatorChar);
            }

            // 3. Ask Steam.
            Step("Looking for the game");
            var found = FindViaSteam().Where(LooksLikeGame).Distinct().ToList();

            if (found.Count == 1)
            {
                Ok($"Found: {found[0]}");
                return found[0];
            }

            if (found.Count > 1)
            {
                Console.WriteLine();
                Console.WriteLine("  Several installs found:");
                for (int i = 0; i < found.Count; i++) Console.WriteLine($"    [{i + 1}] {found[i]}");
                Console.WriteLine();
                Console.Write("  Which one? ");
                string answer = Console.ReadLine();
                if (int.TryParse(answer, out int pick) && pick >= 1 && pick <= found.Count) return found[pick - 1];
                return null;
            }

            // 4. Give up gracefully and ask.
            Info("Could not find the game automatically.");
            Console.WriteLine();
            Console.WriteLine("  In Steam: right-click the game, Manage, Browse local files.");
            Console.WriteLine("  Paste that folder path below (or press Enter to cancel).");
            Console.WriteLine();
            Console.Write("  Path: ");
            string typed = (Console.ReadLine() ?? "").Trim().Trim('"');
            if (typed.Length == 0) return null;

            if (!LooksLikeGame(typed))
            {
                Fail("That folder has no .exe in it, so it is not the game folder.");
                return null;
            }
            return typed;
        }

        private static bool LooksLikeGame(string dir)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(dir) || !Directory.Exists(dir)) return false;
                // The safest marker that survives a rename: Unity's data folder beside an exe.
                bool hasExe = Directory.GetFiles(dir, "*.exe").Any();
                bool hasData = Directory.GetDirectories(dir, "*_Data").Any();
                return hasExe && hasData;
            }
            catch { return false; }
        }

        private static IEnumerable<string> FindViaSteam()
        {
            string steamPath = null;
            try
            {
                steamPath = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Valve\Steam", "SteamPath", null) as string
                         ?? Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath", null) as string;
            }
            catch { /* no Steam, or no permission to read the key */ }

            var libraries = new List<string>();
            if (!string.IsNullOrEmpty(steamPath)) libraries.Add(steamPath);

            // Every extra library folder is listed in this file; without parsing it, a game on
            // a second drive is invisible, which is the common case for large libraries.
            if (!string.IsNullOrEmpty(steamPath))
            {
                string vdf = Path.Combine(steamPath, "steamapps", "libraryfolders.vdf");
                if (File.Exists(vdf))
                {
                    try
                    {
                        string text = File.ReadAllText(vdf);
                        foreach (Match m in Regex.Matches(text, "\"path\"\\s*\"([^\"]+)\""))
                            libraries.Add(m.Groups[1].Value.Replace(@"\\", @"\"));
                    }
                    catch { /* a malformed vdf just means fewer candidates */ }
                }
            }

            foreach (var drive in new[] { "C", "D", "E", "F" })
            {
                libraries.Add($@"{drive}:\Program Files (x86)\Steam");
                libraries.Add($@"{drive}:\Steam");
                libraries.Add($@"{drive}:\SteamLibrary");
            }

            foreach (var library in libraries.Distinct())
            {
                string candidate = Path.Combine(library, "steamapps", "common", GameFolderName);
                if (Directory.Exists(candidate)) yield return candidate;

                // Fall back to the app manifest, in case the folder was renamed. The lookup
                // is done outside an iterator try/catch, which C# does not permit.
                string byManifest = InstallDirFromManifest(library);
                if (byManifest != null) yield return byManifest;
            }
        }

        /// <summary>Reads the install folder Steam recorded for this app id, which survives a
        /// folder rename that the common/&lt;name&gt; guess would miss.</summary>
        private static string InstallDirFromManifest(string library)
        {
            try
            {
                string manifest = Path.Combine(library, "steamapps", $"appmanifest_{SteamAppId}.acf");
                if (!File.Exists(manifest)) return null;

                var m = Regex.Match(File.ReadAllText(manifest), "\"installdir\"\\s*\"([^\"]+)\"");
                if (!m.Success) return null;

                string dir = Path.Combine(library, "steamapps", "common", m.Groups[1].Value);
                return Directory.Exists(dir) ? dir : null;
            }
            catch { return null; }
        }

        // --- resources and output ---------------------------------------------------

        private static byte[] ReadResource(string endsWith)
        {
            var asm = Assembly.GetExecutingAssembly();
            string name = asm.GetManifestResourceNames()
                             .FirstOrDefault(n => n.EndsWith(endsWith, StringComparison.OrdinalIgnoreCase));
            if (name == null) return null;

            using (var stream = asm.GetManifestResourceStream(name))
            using (var memory = new MemoryStream())
            {
                if (stream == null) return null;
                stream.CopyTo(memory);
                return memory.ToArray();
            }
        }

        private static void Banner()
        {
            Console.ForegroundColor = ConsoleColor.Green;
            Console.WriteLine();
            Console.WriteLine("  GambleMenu");
            Console.ResetColor();
            Console.WriteLine("  a mod menu for Gamble With Your Friends");
            Console.WriteLine("  ------------------------------------------------");
            Console.WriteLine();
        }

        private static void Step(string s) { Console.ForegroundColor = ConsoleColor.White; Console.WriteLine($"  {s}..."); Console.ResetColor(); }
        private static void Ok(string s) { Console.ForegroundColor = ConsoleColor.Green; Console.WriteLine($"  [ok] {s}"); Console.ResetColor(); }
        private static void Info(string s) { Console.ForegroundColor = ConsoleColor.Gray; Console.WriteLine($"  {s}"); Console.ResetColor(); }
        private static void Fail(string s) { Console.ForegroundColor = ConsoleColor.Red; Console.WriteLine($"  [!] {s}"); Console.ResetColor(); }
        private static void Highlight(string s) { Console.ForegroundColor = ConsoleColor.Cyan; Console.WriteLine(s); Console.ResetColor(); }

        private static int Done(int code)
        {
            Console.WriteLine();
            Console.WriteLine("  Press any key to close.");
            try { Console.ReadKey(true); } catch { /* no console when double-clicked from some shells */ }
            return code;
        }
    }
}
