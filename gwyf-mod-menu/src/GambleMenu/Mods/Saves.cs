using System.Globalization;
using System.IO;
using System.Linq;
using GambleMenu.Core;
using UnityEngine;

namespace GambleMenu.Mods
{
    /// <summary>
    /// Edits a save slot on disk.
    ///
    /// Unlike the live economy mods this survives a restart, and equally it does nothing to
    /// the run currently in memory — the slot has to be loaded again. Both halves of that are
    /// stated in the UI, because "I set it to a trillion and nothing happened" is otherwise
    /// the obvious and wrong conclusion.
    /// </summary>
    internal sealed class SaveEditor : Mod
    {
        public override string Id => "saves.editor";
        public override string Name => "Save file editor";
        public override string Description => "Writes money, quota and floor straight into a save. Takes effect the next time that slot loads.";
        public override Category Cat => Category.Saves;
        public override Authority Auth => Authority.Anywhere;
        public override bool IsToggle => false;
        public override string[] Tags => new[] { "save", "file", "edit", "money", "permanent", "disk" };

        private StringOption _saveName;
        private LongOption _money;
        private LongOption _quota;
        private IntOption _floor;

        protected override void Build()
        {
            _saveName = Opt(new StringOption("saves.editor.name", "Save slot", "",
                "Leave blank to use the slot the game currently has selected.") { Placeholder = "(currently selected slot)" });
            _money = Opt(new LongOption("saves.editor.money", "money", 1_000_000_000L, 0L, long.MaxValue / 4)
            { Presets = new[] { 1_000_000L, 1_000_000_000L, 1_000_000_000_000L } });
            _quota = Opt(new LongOption("saves.editor.quota", "currentQuota", 1_000L, 0L, long.MaxValue / 4)
            { Presets = new[] { 0L, 1_000L } });
            _floor = Opt(new IntOption("saves.editor.floor", "currentFloor", 0, 0, 16));

            Act("Write money", () => Patch("money", _money.Value.ToString(CultureInfo.InvariantCulture)));
            Act("Write quota", () => Patch("currentQuota", _quota.Value.ToString(CultureInfo.InvariantCulture)));
            Act("Write floor", () => Patch("currentFloor", _floor.Value.ToString(CultureInfo.InvariantCulture)));
            Act("Write all three", () =>
            {
                string target = Target();
                if (target == null) return;
                bool ok = RunState.PatchSaveField(target, "money", _money.Value.ToString(CultureInfo.InvariantCulture));
                ok &= RunState.PatchSaveField(target, "currentQuota", _quota.Value.ToString(CultureInfo.InvariantCulture));
                ok &= RunState.PatchSaveField(target, "currentFloor", _floor.Value.ToString(CultureInfo.InvariantCulture));
                if (ok) Notifier.Success($"'{target}' rewritten. Load that slot to see it.");
            }, "Applies all three values in one pass.");

            Act("Read values from the slot", () =>
            {
                string target = Target();
                if (target == null) return;
                string json = RunState.ReadSave(target);
                if (json == null) { Notifier.Error($"Save '{target}' could not be read."); return; }
                if (JsonField.TryReadLong(json, "money", out long m)) _money.Value = m;
                if (JsonField.TryReadLong(json, "currentQuota", out long q)) _quota.Value = q;
                if (JsonField.TryReadLong(json, "currentFloor", out long f)) _floor.Value = (int)f;
                Notifier.Info($"Loaded the current values from '{target}'.");
            }, "Fills the fields above with what is in the file now.");
        }

        private string Target()
        {
            string name = string.IsNullOrEmpty(_saveName.Value) ? RunState.SelectedSaveName : _saveName.Value.Trim();
            if (string.IsNullOrEmpty(name))
            {
                Notifier.Warn("No slot selected — open the save menu once, or type a slot name.");
                return null;
            }
            if (!File.Exists(RunState.SavePath(name)))
            {
                var available = RunState.ListSaves();
                Notifier.Error(available.Length == 0
                    ? "No save files exist yet."
                    : $"No slot called '{name}'. Found: {string.Join(", ", available.Take(4))}");
                return null;
            }
            return name;
        }

        private void Patch(string field, string value)
        {
            string target = Target();
            if (target == null) return;
            if (RunState.PatchSaveField(target, field, value))
                Notifier.Success($"'{target}' → {field} = {value}. Load that slot to see it.");
        }

    }

    internal sealed class SaveBackups : Mod
    {
        public override string Id => "saves.backup";
        public override string Name => "Save backups";
        public override string Description => "Timestamped copies of a slot, and a way back to the newest one.";
        public override Category Cat => Category.Saves;
        public override bool IsToggle => false;
        public override string[] Tags => new[] { "backup", "restore", "undo", "safety", "copy" };

        private StringOption _saveName;

        protected override void Build()
        {
            _saveName = Opt(new StringOption("saves.backup.name", "Save slot", "",
                "Blank uses the slot the game currently has selected.") { Placeholder = "(currently selected slot)" });

            Act("Back up now", () =>
            {
                string name = Resolve();
                if (name == null) return;
                string path = RunState.BackupSave(name);
                if (path == null) { Notifier.Error($"Could not back up '{name}'."); return; }
                Notifier.Success($"Backed up to {Path.GetFileName(path)}.");
            });

            Act("Restore newest backup", () =>
            {
                string name = Resolve();
                if (name == null) return;
                var backups = RunState.ListBackups(name);
                if (backups.Length == 0) { Notifier.Warn($"No backups exist for '{name}'."); return; }

                // Names carry a sortable yyyyMMdd-HHmmss stamp, so ordinal order is time order.
                string newest = backups.OrderBy(b => b, System.StringComparer.Ordinal).Last();
                try
                {
                    string contents = File.ReadAllText(newest);
                    if (RunState.WriteSave(name, contents))
                        Notifier.Success($"'{name}' restored from {Path.GetFileName(newest)}.");
                }
                catch (System.Exception ex)
                {
                    Log.Error($"restore of '{name}' failed: {ex}");
                    Notifier.Error($"Restore failed: {ex.Message}");
                }
            }, "Overwrites the slot with its most recent backup.", destructive: true);

            Act("Count backups", () =>
            {
                string name = Resolve();
                if (name == null) return;
                var backups = RunState.ListBackups(name);
                Notifier.Info(backups.Length == 0
                    ? $"No backups for '{name}' yet."
                    : $"'{name}' has {backups.Length} backup(s); newest is {Path.GetFileName(backups.OrderBy(b => b, System.StringComparer.Ordinal).Last())}.");
            });

            Act("Open the saves folder", () => Application.OpenURL("file://" + RunState.SavesDir), RunState.SavesDir);
        }

        private string Resolve()
        {
            string name = string.IsNullOrEmpty(_saveName.Value) ? RunState.SelectedSaveName : _saveName.Value.Trim();
            if (string.IsNullOrEmpty(name)) { Notifier.Warn("No slot selected — type a slot name."); return null; }
            if (!File.Exists(RunState.SavePath(name))) { Notifier.Error($"No slot called '{name}'."); return null; }
            return name;
        }
    }
}
