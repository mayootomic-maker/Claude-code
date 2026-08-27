using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using HarmonyLib;
using UnityEngine;

namespace GambleMenu.Core
{
    internal enum Category { Economy, Timing, Progression, Saves, Player, Visual, Automation, Session, Developer }

    /// <summary>Where a mod may safely run. The game is co-op over Mirror with a server-
    /// authoritative simulation, so this is about not corrupting a friend's session.</summary>
    internal enum Authority
    {
        /// <summary>Purely local — visuals, HUD, camera. Nobody else is affected.</summary>
        Anywhere,
        /// <summary>Writes state the server owns. On a client the write is either reverted on
        /// the next sync or desyncs the lobby, so it is refused rather than half-applied.</summary>
        HostOnly,
        /// <summary>Disruptive enough that running it with friends present would wreck their
        /// run rather than enhance it.</summary>
        SoloOnly
    }

    /// <summary>A one-shot button on a mod card, as opposed to a persistent toggle.</summary>
    internal sealed class ModAction
    {
        public string Label;
        public string Tooltip;
        public Action Run;
        /// <summary>Optional gate; when it returns false the button renders disabled.</summary>
        public Func<bool> CanRun;
        /// <summary>Marks destructive actions so the UI can style and confirm them.</summary>
        public bool Destructive;
    }

    internal abstract class Mod
    {
        public abstract string Id { get; }
        public abstract string Name { get; }
        public abstract string Description { get; }
        public abstract Category Cat { get; }

        public virtual Authority Auth => Authority.Anywhere;
        public virtual string[] Tags => Array.Empty<string>();

        /// <summary>Game handles this mod cannot work without. Unresolved ones make the mod
        /// unavailable with a stated reason instead of throwing mid-frame.</summary>
        public virtual Binding[] Requires => Array.Empty<Binding>();

        /// <summary>False for mods that are only a set of buttons, so no on/off switch is drawn.</summary>
        public virtual bool IsToggle => true;

        public BoolOption Enabled { get; private set; }
        public KeyOption Hotkey { get; private set; }
        public readonly List<Option> Options = new List<Option>();
        public readonly List<ModAction> Actions = new List<ModAction>();

        /// <summary>Set when the mod's own code throws, so a broken mod reports itself
        /// instead of spamming the log every frame.</summary>
        public string Fault { get; private set; }

        private Harmony _harmony;
        private bool _patched;
        private bool _running;

        // --- availability ----------------------------------------------------------

        public bool BindingsOk => Requires.All(b => b != null && b.Ok);

        public string MissingBindingReason()
        {
            var missing = Requires.Where(b => b == null || !b.Ok).ToList();
            if (missing.Count == 0) return null;
            var first = missing[0];
            string name = first?.Id ?? "unknown";
            return missing.Count == 1
                ? $"needs {name}, which this game build does not expose"
                : $"needs {name} and {missing.Count - 1} more binding(s) this game build does not expose";
        }

        /// <summary>Why this mod cannot act right now, or null when it can. Recomputed live
        /// because lobby state changes underneath it.</summary>
        public string BlockedReason()
        {
            if (Fault != null) return $"disabled after an error: {Fault}";
            if (!BindingsOk) return MissingBindingReason();
            if (!Settings.RespectAuthority.Value) return null;

            switch (Auth)
            {
                case Authority.HostOnly when GameBridge.IsConnected && !GameBridge.IsHost:
                    return "host only — you are a client in this lobby, and writing here would desync it";
                case Authority.SoloOnly when GameBridge.PlayerCount > 1:
                    return $"solo only — {GameBridge.PlayerCount} players are in this lobby";
                default:
                    return null;
            }
        }

        public bool Runnable => BlockedReason() == null;

        // --- registration ----------------------------------------------------------

        internal void Register()
        {
            Enabled = new BoolOption($"{Id}.enabled", "Enabled", false);
            Hotkey = new KeyOption($"{Id}.hotkey", "Hotkey", KeyCode.None,
                "Press to toggle this mod without opening the menu.");
            Enabled.Changed += OnEnabledChanged;
            _harmony = new Harmony($"com.claude.gamblemenu.{Id}");
            Build();
        }

        /// <summary>Declare options and actions here. Called once at registration, before
        /// any config is loaded, so defaults are in place when values are restored.</summary>
        protected virtual void Build() { }

        protected T Opt<T>(T option) where T : Option { Options.Add(option); return option; }
        protected void Act(ModAction action) => Actions.Add(action);

        protected void Act(string label, Action run, string tooltip = null, Func<bool> canRun = null, bool destructive = false)
            => Actions.Add(new ModAction { Label = label, Run = run, Tooltip = tooltip, CanRun = canRun, Destructive = destructive });

        // --- lifecycle -------------------------------------------------------------

        private void OnEnabledChanged()
        {
            if (Enabled.Value) Start();
            else Stop();
        }

        private void Start()
        {
            if (_running) return;
            string blocked = BlockedReason();
            if (blocked != null)
            {
                Enabled.Value = false;
                Notifier.Warn($"{Name}: {blocked}");
                return;
            }
            try
            {
                ApplyPatches();
                OnEnable();
                _running = true;
            }
            catch (Exception ex)
            {
                Trip(ex, "while enabling");
            }
        }

        private void Stop()
        {
            if (!_running) return;
            _running = false;
            try { OnDisable(); }
            catch (Exception ex) { Log.Error($"{Id}.OnDisable threw: {ex}"); }
            RemovePatches();
        }

        /// <summary>Latches a fault, switches the mod off and tells the user once. A mod that
        /// throws every frame would otherwise bury the log and stutter the game.</summary>
        private void Trip(Exception ex, string phase)
        {
            Fault = ex.Message;
            Log.Error($"{Id} faulted {phase}: {ex}");
            Notifier.Error($"{Name} was switched off after an error — see the BepInEx log.");
            _running = false;
            Enabled.Value = false;
            RemovePatches();
        }

        public void ClearFault() => Fault = null;

        internal void Tick()
        {
            if (!_running) return;
            if (!Runnable) { Enabled.Value = false; return; }
            try { OnUpdate(); }
            catch (Exception ex) { Trip(ex, "in OnUpdate"); }
        }

        internal void TickLate()
        {
            if (!_running) return;
            try { OnLateUpdate(); }
            catch (Exception ex) { Trip(ex, "in OnLateUpdate"); }
        }

        internal void DrawOverlay()
        {
            if (!_running) return;
            try { OnDrawOverlay(); }
            catch (Exception ex) { Trip(ex, "in OnDrawOverlay"); }
        }

        protected virtual void OnEnable() { }
        protected virtual void OnDisable() { }
        protected virtual void OnUpdate() { }
        protected virtual void OnLateUpdate() { }

        /// <summary>Screen-space drawing while the mod is on, whether or not the menu is open.</summary>
        protected virtual void OnDrawOverlay() { }

        // --- patching --------------------------------------------------------------

        /// <summary>
        /// Patches to install while enabled, as (target, prefix, postfix) triples.
        ///
        /// Targets come from GameBridge rather than typeof(), so patches are declared and
        /// removed dynamically — that is what makes a toggle genuinely turn the hook off
        /// rather than leaving a dead patch running a boolean check forever.
        /// </summary>
        protected virtual IEnumerable<PatchSpec> Patches() => Enumerable.Empty<PatchSpec>();

        private void ApplyPatches()
        {
            if (_patched) return;
            foreach (var spec in Patches())
            {
                if (spec.Target == null)
                {
                    Log.Warn($"{Id}: skipping a patch with an unresolved target");
                    continue;
                }
                _harmony.Patch(spec.Target,
                    prefix: spec.Prefix == null ? null : new HarmonyMethod(spec.Prefix),
                    postfix: spec.Postfix == null ? null : new HarmonyMethod(spec.Postfix));
                _patched = true;
            }
        }

        private void RemovePatches()
        {
            if (!_patched) return;
            try { _harmony.UnpatchSelf(); }
            catch (Exception ex) { Log.Error($"{Id}: unpatch failed: {ex}"); }
            _patched = false;
        }

        public bool MatchesSearch(string needle)
        {
            if (string.IsNullOrEmpty(needle)) return true;
            if (Name.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (Description.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (Cat.ToString().IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) return true;
            foreach (var tag in Tags)
                if (tag.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) return true;
            foreach (var opt in Options)
                if (opt.Label.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) return true;
            return false;
        }
    }

    internal sealed class PatchSpec
    {
        public MethodBase Target;
        public MethodInfo Prefix;
        public MethodInfo Postfix;

        public static PatchSpec Of(MethodBinding binding, MethodInfo prefix = null, MethodInfo postfix = null)
            => new PatchSpec { Target = binding != null && binding.Ok ? binding.Method : null, Prefix = prefix, Postfix = postfix };
    }
}
