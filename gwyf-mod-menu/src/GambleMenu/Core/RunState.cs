using System;
using System.IO;
using System.Reflection;
using UnityEngine;
using Object = UnityEngine.Object;

namespace GambleMenu.Core
{
    /// <summary>
    /// Read and write access to the run in progress, plus the save files on disk.
    ///
    /// Two very different routes to the same numbers, and the difference matters:
    /// the live object is what the game is reading this frame, while a save file only takes
    /// effect the next time that slot loads. Live edits are immediate and lost on quit; file
    /// edits are permanent and inert until reload. Mods say which they are doing.
    /// </summary>
    internal static class RunState
    {
        private static Object _owner;
        private static FieldInfo _field;
        private static float _nextSearch;

        /// <summary>
        /// How long to wait before sweeping the scene again after a failed lookup.
        ///
        /// Before a run is loaded there is nothing to find, and that is the state the game
        /// sits in for minutes at a time on the main menu — searching every frame there costs
        /// a full component sweep per frame for a result that cannot change until a scene does.
        /// </summary>
        private const float SearchInterval = 2f;

        /// <summary>The live SaveData instance, or null when no run is loaded.</summary>
        public static object Live
        {
            get
            {
                if (!GameBridge.TSaveData.Ok) return null;

                if (_owner == null || _field == null)
                {
                    if (Time.unscaledTime < _nextSearch) return null;
                    _nextSearch = Time.unscaledTime + SearchInterval;

                    if (!Reflect.FindOwnerOf(GameBridge.TSaveData.Type, out _owner, out _field,
                                             GameBridge.TSaveManager, GameBridge.TMoneyManager,
                                             GameBridge.TGameManager, GameBridge.TLocalSaveMgr))
                        return null;
                    Log.Info($"live run state found on {_owner.GetType().Name}.{_field.Name}");
                }

                try { return _field.GetValue(_owner); }
                catch (Exception ex) { Log.Warn($"could not read live run state: {ex.Message}"); return null; }
            }
        }

        public static bool Available => Live != null;

        /// <summary>Drops the cached owner so the next access re-searches. Called on scene load.</summary>
        public static void Invalidate()
        {
            _owner = null;
            _field = null;
            _nextSearch = 0f;
        }

        // --- live fields ------------------------------------------------------------

        private static long? ReadLong(FieldBinding binding)
        {
            var live = Live;
            if (live == null || !binding.Ok) return null;
            object v = binding.Get(live);
            if (v == null) return null;
            try { return Convert.ToInt64(v); } catch { return null; }
        }

        private static bool WriteLong(FieldBinding binding, long value)
        {
            var live = Live;
            if (live == null || !binding.Ok) return false;
            try
            {
                object converted = Convert.ChangeType(value, binding.Field.FieldType);
                return binding.Set(live, converted);
            }
            catch (Exception ex)
            {
                Log.Warn($"could not write {binding.Id}: {ex.Message}");
                return false;
            }
        }

        public static long? Money
        {
            get => ReadLong(GameBridge.SdMoney);
            set { if (value.HasValue) WriteLong(GameBridge.SdMoney, value.Value); }
        }

        public static long? Quota
        {
            get => ReadLong(GameBridge.SdCurrentQuota);
            set { if (value.HasValue) WriteLong(GameBridge.SdCurrentQuota, value.Value); }
        }

        public static long? NextFloorRequirement
        {
            get => ReadLong(GameBridge.SdRequiredQuotaToNextFloor);
            set { if (value.HasValue) WriteLong(GameBridge.SdRequiredQuotaToNextFloor, value.Value); }
        }

        public static int? Floor
        {
            get
            {
                var live = Live;
                if (live == null || !GameBridge.SdCurrentFloor.Ok) return null;
                object v = GameBridge.SdCurrentFloor.Get(live);
                if (v == null) return null;
                try { return Convert.ToInt32(v); } catch { return null; }
            }
            set
            {
                var live = Live;
                if (live == null || !value.HasValue || !GameBridge.SdCurrentFloor.Ok) return;
                GameBridge.SdCurrentFloor.Set(live, value.Value);
            }
        }

        /// <summary>Highest floor index the game defines, read from the settings asset's floor
        /// table. Null when that table is not exposed on this build.</summary>
        public static int? TopFloor
        {
            get
            {
                var settings = GameBridge.Settings();
                if (settings == null || !GameBridge.FloorData.Ok) return null;
                if (!(GameBridge.FloorData.Get(settings) is System.Collections.ICollection list)) return null;
                return list.Count > 0 ? list.Count - 1 : (int?)null;
            }
        }

        public static float? DayDuration
        {
            get
            {
                var settings = GameBridge.Settings();
                if (settings == null || !GameBridge.DayDuration.Ok) return null;
                object v = GameBridge.DayDuration.Get(settings);
                return v is float f ? f : (float?)null;
            }
            set
            {
                var settings = GameBridge.Settings();
                if (settings == null || !value.HasValue || !GameBridge.DayDuration.Ok) return;
                GameBridge.DayDuration.Set(settings, value.Value);
            }
        }

        // --- save files -------------------------------------------------------------

        public static string SavesDir => Path.Combine(Application.persistentDataPath, "Saves");

        /// <summary>The slot the game currently considers selected. The key is the one the
        /// game itself writes; reading it is how a save-file edit finds the right file.</summary>
        public static string SelectedSaveName
        {
            get
            {
                try { return PlayerPrefs.GetString("SelectedSaveName", ""); }
                catch { return ""; }
            }
        }

        public static string SavePath(string saveName) => Path.Combine(SavesDir, saveName + ".json");

        public static string[] ListSaves()
        {
            try
            {
                if (!Directory.Exists(SavesDir)) return Array.Empty<string>();
                var files = Directory.GetFiles(SavesDir, "*.json");
                var names = new string[files.Length];
                for (int i = 0; i < files.Length; i++) names[i] = Path.GetFileNameWithoutExtension(files[i]);
                return names;
            }
            catch (Exception ex)
            {
                Log.Error($"could not list saves: {ex.Message}");
                return Array.Empty<string>();
            }
        }

        /// <summary>
        /// Copies a save next to itself before it is written.
        ///
        /// Backups are timestamped rather than overwriting one another: the failure this
        /// guards against is noticing a bad edit several edits later, and a single rolling
        /// backup would have been overwritten by then.
        /// </summary>
        public static string BackupSave(string saveName)
        {
            string source = SavePath(saveName);
            if (!File.Exists(source)) return null;
            try
            {
                string stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
                string target = Path.Combine(SavesDir, $"{saveName}.{stamp}.gmbak");
                File.Copy(source, target, false);
                Log.Info($"backed up '{saveName}' to {Path.GetFileName(target)}");
                return target;
            }
            catch (Exception ex)
            {
                Log.Error($"backup of '{saveName}' failed: {ex.Message}");
                return null;
            }
        }

        public static string[] ListBackups(string saveName)
        {
            try
            {
                if (!Directory.Exists(SavesDir)) return Array.Empty<string>();
                return Directory.GetFiles(SavesDir, saveName + ".*.gmbak");
            }
            catch { return Array.Empty<string>(); }
        }

        public static string ReadSave(string saveName)
        {
            try
            {
                string path = SavePath(saveName);
                return File.Exists(path) ? File.ReadAllText(path) : null;
            }
            catch (Exception ex)
            {
                Log.Error($"could not read save '{saveName}': {ex.Message}");
                return null;
            }
        }

        public static bool WriteSave(string saveName, string json)
        {
            if (Settings.AutoBackupSaves.Value) BackupSave(saveName);
            try
            {
                string path = SavePath(saveName);
                string tmp = path + ".tmp";
                File.WriteAllText(tmp, json);
                if (File.Exists(path)) File.Delete(path);
                File.Move(tmp, path);
                return true;
            }
            catch (Exception ex)
            {
                Log.Error($"could not write save '{saveName}': {ex.Message}");
                Notifier.Error($"Writing save '{saveName}' failed: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Rewrites one field inside a save's JSON, leaving everything else byte-for-byte.
        ///
        /// JsonUtility round-tripping would need the game's SaveData type at compile time and
        /// would silently drop any field this plugin does not know about. Editing the text in
        /// place cannot lose data it never parsed.
        /// </summary>
        public static bool PatchSaveField(string saveName, string field, string rawValue)
        {
            string json = ReadSave(saveName);
            if (json == null)
            {
                Notifier.Error($"Save '{saveName}' not found on disk.");
                return false;
            }

            var result = JsonField.Replace(json, field, rawValue, out string updated);
            if (result != JsonField.Result.Ok)
            {
                Notifier.Warn($"Save '{saveName}': {JsonField.Explain(result, field)}");
                return false;
            }

            if (!WriteSave(saveName, updated)) return false;

            Log.Info($"save '{saveName}': {field} = {rawValue}");
            return true;
        }
    }
}
