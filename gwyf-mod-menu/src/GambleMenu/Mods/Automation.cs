using GambleMenu.Core;
using GambleMenu.UI;
using UnityEngine;

namespace GambleMenu.Mods
{
    /// <summary>
    /// Presses a key for you on a timer.
    ///
    /// Deliberately generic rather than an "auto-spin for machine X": the game's machines are
    /// not a binding this plugin has, and a key repeater aimed at whatever is in front of you
    /// works on all seventeen games of chance instead of on one that was guessed correctly.
    /// </summary>
    internal sealed class AutoPress : Mod
    {
        public override string Id => "auto.press";
        public override string Name => "Auto key press";
        public override string Description => "Repeats a key at a set interval — point at a machine and let it run.";
        public override Category Cat => Category.Automation;
        public override Authority Auth => Authority.Anywhere;
        public override string[] Tags => new[] { "auto", "spin", "repeat", "clicker", "afk", "farm" };

        private KeyOption _key;
        private FloatOption _interval;
        private BoolOption _onlyWhenMenuClosed;
        private float _next;
        private int _pressCount;

        protected override void Build()
        {
            _key = Opt(new KeyOption("auto.press.key", "Key to press", KeyCode.E,
                "The game's interact key by default."));
            _interval = Opt(new FloatOption("auto.press.interval", "Every", 1.5f, 0.1f, 10f)
            { Step = 0.1f, Format = "0.0", Unit = "s" });
            _onlyWhenMenuClosed = Opt(new BoolOption("auto.press.closed", "Pause while this menu is open", true,
                "Stops it firing into the game while you are clicking around in here."));
        }

        protected override void OnEnable()
        {
            _next = Time.unscaledTime + _interval.Value;
            _pressCount = 0;
        }

        protected override void OnDisable()
        {
            if (_pressCount > 0) Notifier.Info($"Auto key press stopped after {_pressCount} press(es).");
        }

        protected override void OnUpdate()
        {
            if (_onlyWhenMenuClosed.Value && MenuController.IsOpenNow) return;
            if (Time.unscaledTime < _next) return;
            _next = Time.unscaledTime + _interval.Value;

            if (!Press.Send(_key.Value))
            {
                Notifier.Error("This game's input backend cannot be driven from a mod — auto press is off.");
                Enabled.Value = false;
                return;
            }
            _pressCount++;
        }
    }

    /// <summary>
    /// Synthesises a keypress.
    ///
    /// Unity offers no supported way to inject into the legacy Input manager, so this drives
    /// the Input System's virtual keyboard when that backend is present and reports honest
    /// failure when it is not — silently doing nothing would look identical to a mod that is
    /// simply not working.
    /// </summary>
    internal static class Press
    {
        private static bool _probed;
        private static bool _supported;
        private static System.Reflection.MethodInfo _queueStateEvent;
        private static object _keyboard;
        private static System.Type _keyboardStateType;

        public static bool Send(KeyCode key)
        {
            if (key == KeyCode.None) return false;
            Probe();
            if (!_supported) return false;

            try
            {
                var state = System.Activator.CreateInstance(_keyboardStateType);
                var press = _keyboardStateType.GetMethod("Press");
                var release = _keyboardStateType.GetMethod("Release");
                var keyEnum = FindType("UnityEngine.InputSystem.Key");
                if (press == null || release == null || keyEnum == null) return false;

                object k = System.Enum.Parse(keyEnum, TranslateName(key));
                press.Invoke(state, new[] { k });
                _queueStateEvent.MakeGenericMethod(_keyboardStateType).Invoke(null, new[] { _keyboard, state, -1.0 });

                var up = System.Activator.CreateInstance(_keyboardStateType);
                release.Invoke(up, new[] { k });
                _queueStateEvent.MakeGenericMethod(_keyboardStateType).Invoke(null, new[] { _keyboard, up, -1.0 });
                return true;
            }
            catch (System.Exception ex)
            {
                Log.Warn($"synthetic keypress failed: {ex.Message}");
                _supported = false;
                return false;
            }
        }

        private static void Probe()
        {
            if (_probed) return;
            _probed = true;
            try
            {
                var keyboardType = FindType("UnityEngine.InputSystem.Keyboard");
                _keyboardStateType = FindType("UnityEngine.InputSystem.LowLevel.KeyboardState");
                var inputSystem = FindType("UnityEngine.InputSystem.InputSystem");
                if (keyboardType == null || _keyboardStateType == null || inputSystem == null) return;

                _keyboard = keyboardType.GetProperty("current",
                    System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)?.GetValue(null);
                if (_keyboard == null) return;

                foreach (var m in inputSystem.GetMethods())
                {
                    if (m.Name != "QueueStateEvent" || !m.IsGenericMethodDefinition) continue;
                    _queueStateEvent = m;
                    break;
                }
                _supported = _queueStateEvent != null;
                Log.Info($"synthetic input: {(_supported ? "available via Input System" : "unavailable")}");
            }
            catch (System.Exception ex)
            {
                Log.Warn($"synthetic input probe failed: {ex.Message}");
                _supported = false;
            }
        }

        private static System.Type FindType(string fullName)
        {
            foreach (var asm in System.AppDomain.CurrentDomain.GetAssemblies())
            {
                try
                {
                    var t = asm.GetType(fullName, false);
                    if (t != null) return t;
                }
                catch { }
            }
            return null;
        }

        private static string TranslateName(KeyCode key)
        {
            switch (key)
            {
                case KeyCode.Return: return "Enter";
                case KeyCode.Alpha0: return "Digit0";
                case KeyCode.Alpha1: return "Digit1";
                case KeyCode.Alpha2: return "Digit2";
                case KeyCode.Alpha3: return "Digit3";
                case KeyCode.Alpha4: return "Digit4";
                case KeyCode.Alpha5: return "Digit5";
                case KeyCode.Alpha6: return "Digit6";
                case KeyCode.Alpha7: return "Digit7";
                case KeyCode.Alpha8: return "Digit8";
                case KeyCode.Alpha9: return "Digit9";
                case KeyCode.LeftControl: return "LeftCtrl";
                default: return key.ToString();
            }
        }
    }
}

namespace GambleMenu.Mods
{
    /// <summary>
    /// Copies the active save on a timer.
    ///
    /// The economy mods write to a live run and the save editor writes to disk; both are
    /// easy to regret. A rolling timestamped backup is the cheapest possible way to make
    /// every one of them reversible.
    /// </summary>
    internal sealed class AutoBackup : Mod
    {
        public override string Id => "auto.backup";
        public override string Name => "Timed save backups";
        public override string Description => "Backs up the current save every few minutes while you play.";
        public override Category Cat => Category.Automation;
        public override string[] Tags => new[] { "backup", "safety", "auto", "save", "timer" };

        private FloatOption _minutes;
        private float _next;
        private int _count;

        protected override void Build()
        {
            _minutes = Opt(new FloatOption("auto.backup.minutes", "Every", 5f, 1f, 60f)
            { Step = 1f, Format = "0", Unit = " min" });
        }

        protected override void OnEnable()
        {
            _next = Time.unscaledTime + _minutes.Value * 60f;
            _count = 0;
        }

        protected override void OnDisable()
        {
            if (_count > 0) Notifier.Info($"Timed backups stopped after {_count} copy(ies).");
        }

        protected override void OnUpdate()
        {
            if (Time.unscaledTime < _next) return;
            _next = Time.unscaledTime + _minutes.Value * 60f;

            string name = RunState.SelectedSaveName;
            if (string.IsNullOrEmpty(name)) return;   // nothing selected yet; try again next tick

            string path = RunState.BackupSave(name);
            if (path == null) return;
            _count++;
            Log.Info($"timed backup {_count} of '{name}'");
        }
    }
}
