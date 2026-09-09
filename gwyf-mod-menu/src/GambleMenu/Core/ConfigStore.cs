using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using BepInEx;

namespace GambleMenu.Core
{
    /// <summary>
    /// Persists every option to disk and manages named profiles.
    ///
    /// Writes go through a temp file and a replace so a crash mid-save cannot leave a
    /// truncated config that wipes the user's setup on next launch.
    /// </summary>
    internal static class ConfigStore
    {
        public static string Root => Path.Combine(Paths.ConfigPath, "GambleMenu");
        public static string ProfilesDir => Path.Combine(Root, "profiles");
        private static string ActivePath => Path.Combine(Root, "active.json");

        private static bool _loading;

        /// <summary>True while a load is applying values, so option Changed handlers can tell
        /// a restore from a user edit and skip the "you turned this on" toast.</summary>
        public static bool IsLoading => _loading;

        public static void EnsureDirectories()
        {
            try
            {
                Directory.CreateDirectory(Root);
                Directory.CreateDirectory(ProfilesDir);
            }
            catch (Exception ex)
            {
                Log.Error($"could not create config directory '{Root}': {ex.Message}");
            }
        }

        private static Dictionary<string, string> Snapshot()
        {
            var map = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var o in ModRegistry.AllOptions())
            {
                try { map[o.Key] = o.Serialize(); }
                catch (Exception ex) { Log.Warn($"could not serialize '{o.Key}': {ex.Message}"); }
            }
            return map;
        }

        private static void Apply(Dictionary<string, string> map)
        {
            _loading = true;
            try
            {
                foreach (var o in ModRegistry.AllOptions())
                {
                    if (!map.TryGetValue(o.Key, out string raw)) continue;
                    try { o.Deserialize(raw); }
                    catch (Exception ex) { Log.Warn($"could not restore '{o.Key}' from '{raw}': {ex.Message}"); }
                }
            }
            finally { _loading = false; }
        }

        public static void SaveActive()
        {
            EnsureDirectories();
            WriteAtomic(ActivePath, Json.Write(Snapshot()), "settings");
        }

        public static void LoadActive()
        {
            if (!File.Exists(ActivePath))
            {
                Log.Info("no saved settings yet — starting from defaults");
                return;
            }
            try
            {
                Apply(Json.Read(File.ReadAllText(ActivePath)));
                Log.Info("settings restored");
            }
            catch (Exception ex)
            {
                // A corrupt config must not brick the menu. Keep the bad file for inspection
                // rather than overwriting it on the next autosave.
                string quarantine = ActivePath + ".corrupt";
                try { File.Copy(ActivePath, quarantine, true); } catch { /* best effort */ }
                Log.Error($"settings file unreadable ({ex.Message}); defaults loaded, bad copy kept at {quarantine}");
                Notifier.Error("Your settings file could not be read. Defaults loaded; the old file was kept as active.json.corrupt.");
            }
        }

        // --- profiles ---------------------------------------------------------------

        public static List<string> ListProfiles()
        {
            EnsureDirectories();
            try
            {
                return Directory.GetFiles(ProfilesDir, "*.json")
                                .Select(Path.GetFileNameWithoutExtension)
                                .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
                                .ToList();
            }
            catch (Exception ex)
            {
                Log.Error($"could not list profiles: {ex.Message}");
                return new List<string>();
            }
        }

        public static bool SaveProfile(string name)
        {
            string safe = Sanitize(name);
            if (safe.Length == 0)
            {
                Notifier.Warn("A profile needs a name.");
                return false;
            }
            EnsureDirectories();
            bool ok = WriteAtomic(Path.Combine(ProfilesDir, safe + ".json"), Json.Write(Snapshot()), $"profile '{safe}'");
            if (ok) Notifier.Success($"Profile '{safe}' saved.");
            return ok;
        }

        public static bool LoadProfile(string name)
        {
            string path = Path.Combine(ProfilesDir, Sanitize(name) + ".json");
            if (!File.Exists(path))
            {
                Notifier.Error($"Profile '{name}' is gone from disk.");
                return false;
            }
            try
            {
                Apply(Json.Read(File.ReadAllText(path)));
                Notifier.Success($"Profile '{name}' loaded.");
                return true;
            }
            catch (Exception ex)
            {
                Log.Error($"profile '{name}' failed to load: {ex}");
                Notifier.Error($"Profile '{name}' could not be read — it may be corrupt.");
                return false;
            }
        }

        public static bool DeleteProfile(string name)
        {
            string path = Path.Combine(ProfilesDir, Sanitize(name) + ".json");
            try
            {
                if (!File.Exists(path)) return false;
                File.Delete(path);
                Notifier.Info($"Profile '{name}' deleted.");
                return true;
            }
            catch (Exception ex)
            {
                Log.Error($"could not delete profile '{name}': {ex.Message}");
                Notifier.Error($"Could not delete '{name}': {ex.Message}");
                return false;
            }
        }

        public static void ResetAllToDefaults()
        {
            foreach (var o in ModRegistry.AllOptions())
            {
                try { o.ResetToDefault(); }
                catch (Exception ex) { Log.Warn($"could not reset '{o.Key}': {ex.Message}"); }
            }
            Notifier.Info("Everything reset to defaults.");
        }

        private static bool WriteAtomic(string path, string contents, string what)
        {
            string tmp = path + ".tmp";
            try
            {
                File.WriteAllText(tmp, contents);
                if (File.Exists(path)) File.Delete(path);
                File.Move(tmp, path);
                return true;
            }
            catch (Exception ex)
            {
                Log.Error($"could not write {what} to '{path}': {ex.Message}");
                Notifier.Error($"Could not save {what}: {ex.Message}");
                try { if (File.Exists(tmp)) File.Delete(tmp); } catch { /* best effort */ }
                return false;
            }
        }

        private static string Sanitize(string name)
        {
            if (string.IsNullOrEmpty(name)) return string.Empty;
            var invalid = Path.GetInvalidFileNameChars();
            var cleaned = new string(name.Trim().Where(c => Array.IndexOf(invalid, c) < 0).ToArray());
            return cleaned.Length > 64 ? cleaned.Substring(0, 64) : cleaned;
        }
    }
}
