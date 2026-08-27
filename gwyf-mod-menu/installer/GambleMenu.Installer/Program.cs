using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Threading;
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

        /// <summary>How long to wait for the game to shut down cleanly before forcing it.</summary>
        private static readonly TimeSpan CloseTimeout = TimeSpan.FromSeconds(12);

        private static int Main(string[] args)
        {
            Console.Title = "GambleMenu Installer";
            Banner();

            try
            {
                bool uninstall = args.Any(a => a.Equals("--uninstall", StringComparison.OrdinalIgnoreCase));
                bool auto = args.Any(a => a.Equals("--auto", StringComparison.OrdinalIgnoreCase));

                string gameDir = ResolveGameDirectory(args);
                if (gameDir == null)
                {
                    Fail("No game folder was chosen, so nothing was changed.");
                    return Done(1);
                }

                _gameDir = gameDir;
                Info($"Game folder:  {gameDir}");
                Console.WriteLine();

                // Running mid-session is the normal case, not the exception: people install a
                // mod menu because they are already playing and want it now.
                bool wasRunning = HandleRunningGame(gameDir, auto);

                bool ok = uninstall ? Uninstall(gameDir) : Install(gameDir, auto);

                if (ok && wasRunning) RelaunchGame(gameDir);
                return Done(ok ? 0 : 1);
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

        /// <summary>
        /// Lets the user pick the open key before the game has ever run.
        ///
        /// This is the one fallback that cannot fail. Every other route in — a keybind, the
        /// on-screen tab — can be defeated by a keyboard without that key or by the game
        /// holding the cursor, and none of them can be fixed from inside a menu you cannot
        /// open. Writing the choice to the config first sidesteps the whole circle.
        /// </summary>
        private static string ChooseOpenKey(bool auto)
        {
            var choices = new[]
            {
                ("F1", "on every keyboard"),
                ("Insert", "missing on most laptops"),
                ("Home", "usually present"),
                ("BackQuote", "the ` key, left of 1"),
                ("F9", "clear of most game binds"),
            };

            if (auto) return choices[0].Item1;

            Console.WriteLine("  Which key should open the menu?");
            Console.WriteLine();
            for (int i = 0; i < choices.Length; i++)
                Console.WriteLine($"    [{i + 1}] {choices[i].Item1,-12} {choices[i].Item2}");
            Console.WriteLine("    [6] something else");
            Console.WriteLine();
            Console.Write($"  Choice [1-6, Enter for {choices[0].Item1}]: ");

            string answer = (Console.ReadLine() ?? "").Trim();
            string chosen = choices[0].Item1;

            if (answer.Length > 0)
            {
                if (int.TryParse(answer, out int pick) && pick >= 1 && pick <= choices.Length)
                {
                    chosen = choices[pick - 1].Item1;
                }
                else if (answer == "6")
                {
                    Console.WriteLine();
                    Console.WriteLine("  Type a Unity KeyCode name, e.g. F4, Backslash, RightShift, Pause.");
                    Console.Write("  Key: ");
                    string typed = (Console.ReadLine() ?? "").Trim();
                    if (typed.Length > 0) chosen = typed;
                }
            }

            if (WriteOpenKey(chosen)) Ok($"Menu key set to {chosen}.");
            else Info($"Could not write the config; the menu will use its default, {choices[0].Item1}.");

            Info("You can change it later in the menu, under Settings.");
            return chosen;
        }

        /// <summary>
        /// Sets menu.key in the plugin's config without disturbing anything else in it.
        ///
        /// The file is a flat map of quoted strings, so it is read, the one entry replaced or
        /// added, and the whole thing written back — never truncated to just this key, which
        /// would silently wipe an existing setup.
        /// </summary>
        private static bool WriteOpenKey(string keyName)
        {
            try
            {
                string dir = Path.Combine(_gameDir, "BepInEx", "config", "GambleMenu");
                Directory.CreateDirectory(dir);
                string path = Path.Combine(dir, "active.json");

                string existing = File.Exists(path) ? File.ReadAllText(path) : null;
                File.WriteAllText(path, ConfigPatch.Set(existing, "menu.key", keyName));
                return true;
            }
            catch
            {
                // The caller reports this; there is no log file to write to yet.
                return false;
            }
        }

        private static string _gameDir;

        private static bool Install(string gameDir, bool auto)
        {
            _gameDir = gameDir;
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

            string key = ChooseOpenKey(auto);
            Console.WriteLine();
            Highlight($"  Launch the game and press  {key.ToUpperInvariant()}");
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

        // --- running game -----------------------------------------------------------

        /// <summary>
        /// Every process running out of the game folder.
        ///
        /// Matched by executable path rather than by process name: the name is whatever the
        /// build was called, and matching on a guess would either miss the game or, worse,
        /// close an unrelated program that happens to share a name.
        /// </summary>
        private static List<Process> GameProcesses(string gameDir)
        {
            string root = Path.GetFullPath(gameDir).TrimEnd(Path.DirectorySeparatorChar);
            var found = new List<Process>();

            foreach (var process in Process.GetProcesses())
            {
                string path = null;
                try { path = process.MainModule?.FileName; }
                catch { /* most processes refuse MainModule; those are not ours anyway */ }

                if (string.IsNullOrEmpty(path)) continue;
                if (path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                    found.Add(process);
            }
            return found;
        }

        /// <summary>
        /// Closes the game if it is running, so the install can proceed.
        ///
        /// This is not politeness about file locks — though a loaded plugin DLL is genuinely
        /// locked. BepInEx installs itself into the process at startup by proxying winhttp,
        /// so a plugin dropped in while the game is running is not loaded until the next
        /// launch no matter what. Restarting is the whole mechanism, not a workaround.
        /// </summary>
        private static bool HandleRunningGame(string gameDir, bool auto)
        {
            var running = GameProcesses(gameDir);
            if (running.Count == 0) return false;

            Console.WriteLine();
            Info("The game is running.");
            Console.WriteLine();
            Console.WriteLine("  BepInEx loads into the game at startup, so a mod installed now");
            Console.WriteLine("  does not appear until the next launch. This installer can close");
            Console.WriteLine("  the game, install, and start it again for you.");
            Console.WriteLine();

            if (!auto)
            {
                Console.Write("  Close the game, install, and relaunch it? [Y/n] ");
                string answer = (Console.ReadLine() ?? "").Trim().ToLowerInvariant();
                if (answer == "n" || answer == "no")
                {
                    Console.WriteLine();
                    Info("Leaving the game alone. Install now, and it will be there after your next restart.");
                    Console.WriteLine();
                    // The plugin DLL is locked while loaded, so a re-install over a running
                    // copy would fail halfway. Say so rather than half-writing.
                    if (File.Exists(Path.Combine(gameDir, "BepInEx", "plugins", "GambleMenu", "GambleMenu.dll")))
                        Fail("GambleMenu is already loaded in the running game, so its file is locked. Close the game and run this again.");
                    return false;
                }
            }

            Console.WriteLine();
            Step("Closing the game");
            foreach (var process in running)
            {
                try
                {
                    // Ask first: a clean exit lets the game write its save.
                    if (!process.CloseMainWindow()) process.Kill();
                    if (!process.WaitForExit((int)CloseTimeout.TotalMilliseconds))
                    {
                        Info("It did not close on its own — stopping it.");
                        process.Kill();
                        process.WaitForExit(5000);
                    }
                }
                catch (Exception ex)
                {
                    Fail($"Could not close the game: {ex.Message}");
                    Info("Close it yourself, then run this installer again.");
                    return false;
                }
            }

            // Windows releases file handles a moment after the process ends; writing into the
            // folder immediately can still hit a lock.
            Thread.Sleep(1200);
            Ok("Game closed.");
            Console.WriteLine();
            return true;
        }

        private static void RelaunchGame(string gameDir)
        {
            Console.WriteLine();
            Step("Starting the game again");

            // Through Steam where possible: launching the exe directly skips Steam's own
            // setup and the game's networking expects to have been started by it.
            try
            {
                Process.Start($"steam://rungameid/{SteamAppId}");
                Ok("Asked Steam to launch the game.");
                Console.WriteLine();
                Highlight("  When it loads, press  INSERT");
                return;
            }
            catch (Exception ex)
            {
                Info($"Steam would not take the request ({ex.Message}); trying the executable.");
            }

            try
            {
                string exe = Directory.GetFiles(gameDir, "*.exe")
                                      .FirstOrDefault(f => !Path.GetFileName(f).StartsWith("UnityCrash", StringComparison.OrdinalIgnoreCase));
                if (exe == null) { Fail("No executable found to launch — start it from Steam."); return; }

                Process.Start(new ProcessStartInfo(exe) { WorkingDirectory = gameDir, UseShellExecute = true });
                Ok($"Started {Path.GetFileName(exe)}.");
                Console.WriteLine();
                Highlight("  When it loads, press  INSERT");
            }
            catch (Exception ex)
            {
                Fail($"Could not start the game: {ex.Message}");
                Info("Start it from Steam as usual — the menu is installed either way.");
            }
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

            // 3. Ask Steam. A --game= argument points this at any other title.
            string wanted = args.FirstOrDefault(a => a.StartsWith("--game=", StringComparison.OrdinalIgnoreCase));
            string folderName = wanted != null ? wanted.Substring("--game=".Length).Trim('"') : GameFolderName;

            Step($"Looking for {folderName}");
            var found = FindViaSteam(folderName).Where(LooksLikeGame).Distinct().ToList();

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

            // 4. Nothing by that name — offer every Unity game we can see instead. Most of this
            //    menu is engine-level rather than title-specific, so installing it into another
            //    game is a normal thing to want rather than a mistake to guard against.
            Info($"Could not find {folderName} automatically.");

            var unity = FindUnityGames();
            if (unity.Count > 0)
            {
                Console.WriteLine();
                Console.WriteLine($"  Found {unity.Count} Unity game(s) in your Steam libraries:");
                Console.WriteLine();
                for (int i = 0; i < unity.Count; i++)
                    Console.WriteLine($"    [{i + 1}] {Path.GetFileName(unity[i])}");
                Console.WriteLine();
                Console.WriteLine("  Pick a number, or press Enter to type a path instead.");
                Console.Write("  Choice: ");

                string picked = (Console.ReadLine() ?? "").Trim();
                if (int.TryParse(picked, out int chosen) && chosen >= 1 && chosen <= unity.Count)
                    return unity[chosen - 1];
            }

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

        /// <summary>
        /// Every Unity game in the user's Steam libraries.
        ///
        /// Detected by shape — an executable beside a *_Data folder — rather than against any
        /// list of titles, which is the same test used to validate a hand-typed path.
        /// </summary>
        private static List<string> FindUnityGames()
        {
            var games = new List<string>();
            foreach (var library in SteamLibraries())
            {
                string common = Path.Combine(library, "steamapps", "common");
                if (!Directory.Exists(common)) continue;
                try
                {
                    foreach (var dir in Directory.GetDirectories(common))
                        if (LooksLikeGame(dir)) games.Add(dir);
                }
                catch { /* an unreadable library is simply skipped */ }
            }
            return games.Distinct().OrderBy(Path.GetFileName, StringComparer.OrdinalIgnoreCase).ToList();
        }

        private static IEnumerable<string> FindViaSteam(string folderName)
        {
            foreach (var library in SteamLibraries())
            {
                string candidate = Path.Combine(library, "steamapps", "common", folderName);
                if (Directory.Exists(candidate)) yield return candidate;

                // Fall back to the app manifest, in case the folder was renamed. The lookup
                // is done outside an iterator try/catch, which C# does not permit.
                string byManifest = InstallDirFromManifest(library);
                if (byManifest != null) yield return byManifest;
            }
        }

        /// <summary>Steam's own folder plus every extra library folder it knows about.</summary>
        private static List<string> SteamLibraries()
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

            return libraries.Where(l => !string.IsNullOrEmpty(l)).Distinct().ToList();
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
