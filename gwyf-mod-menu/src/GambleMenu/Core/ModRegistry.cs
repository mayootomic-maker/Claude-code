using System;
using System.Collections.Generic;
using System.Linq;

namespace GambleMenu.Core
{
    /// <summary>Holds every registered mod and fans the per-frame callbacks out to them.</summary>
    internal static class ModRegistry
    {
        private static readonly List<Mod> _mods = new List<Mod>();
        private static readonly Dictionary<string, Mod> _byId = new Dictionary<string, Mod>(StringComparer.Ordinal);

        public static IReadOnlyList<Mod> All => _mods;

        public static void Add(Mod mod)
        {
            if (_byId.ContainsKey(mod.Id))
            {
                Log.Error($"duplicate mod id '{mod.Id}' — the second registration was dropped");
                return;
            }
            try
            {
                mod.Register();
                _mods.Add(mod);
                _byId[mod.Id] = mod;
            }
            catch (Exception ex)
            {
                Log.Error($"mod '{mod.Id}' failed to register and was skipped: {ex}");
            }
        }

        public static Mod Get(string id) => _byId.TryGetValue(id, out var m) ? m : null;

        public static IEnumerable<Mod> InCategory(Category cat) => _mods.Where(m => m.Cat == cat);

        public static IEnumerable<Category> UsedCategories() =>
            Enum.GetValues(typeof(Category)).Cast<Category>()
                .Where(c => _mods.Any(m => m.Cat == c && (m.BindingsOk || Settings.ShowUnavailable.Value)));

        public static int EnabledCount => _mods.Count(m => m.Enabled.Value);

        /// <summary>Every persisted option in the plugin: the global settings plus each mod's
        /// switch, hotkey and own options.</summary>
        public static IEnumerable<Option> AllOptions()
        {
            foreach (var o in Settings.All) yield return o;
            foreach (var m in _mods)
            {
                yield return m.Enabled;
                yield return m.Hotkey;
                foreach (var o in m.Options) yield return o;
            }
        }

        public static void Tick()
        {
            for (int i = 0; i < _mods.Count; i++) _mods[i].Tick();
        }

        public static void TickLate()
        {
            for (int i = 0; i < _mods.Count; i++) _mods[i].TickLate();
        }

        public static void DrawOverlays()
        {
            for (int i = 0; i < _mods.Count; i++) _mods[i].DrawOverlay();
        }

        /// <summary>Checks every mod's hotkey. Skipped while a rebind is capturing keys so the
        /// key being bound does not also fire the mod it is being bound to.</summary>
        public static void PollHotkeys()
        {
            for (int i = 0; i < _mods.Count; i++)
            {
                var mod = _mods[i];
                if (!mod.Hotkey.IsBound) continue;
                if (!InputBridge.GetKeyDown(mod.Hotkey.Value)) continue;

                if (!mod.Runnable && !mod.Enabled.Value)
                {
                    Notifier.Warn($"{mod.Name}: {mod.BlockedReason()}");
                    continue;
                }
                mod.Enabled.Value = !mod.Enabled.Value;
                Notifier.Info($"{mod.Name} {(mod.Enabled.Value ? "on" : "off")}");
            }
        }

        /// <summary>Switches off every mod in one category, for the header action on its page.</summary>
        public static int DisableCategory(Category cat)
        {
            int n = 0;
            foreach (var m in _mods)
            {
                if (m.Cat != cat || !m.Enabled.Value) continue;
                m.Enabled.Value = false;
                n++;
            }
            return n;
        }

        /// <summary>Switches everything off. Bound to the panic key and used on shutdown so
        /// the game is never left holding a patched method after the plugin stops.</summary>
        public static void DisableAll(bool quiet = false)
        {
            int n = 0;
            foreach (var m in _mods)
            {
                if (!m.Enabled.Value) continue;
                m.Enabled.Value = false;
                n++;
            }
            if (n > 0 && !quiet) Notifier.Info($"Panic — {n} mod(s) switched off.");
        }
    }
}
