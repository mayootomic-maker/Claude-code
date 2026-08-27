using System;
using System.Collections.Generic;
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

namespace GambleMenu.Mods
{
    /// <summary>
    /// Presses a key the moment the outcome mapper marks a favourable result.
    ///
    /// It reads that mod's verdict rather than deriving its own, so there is only ever one
    /// definition of a good result in play and it is the one with the evidence behind it.
    /// </summary>
    internal sealed class SignalAutoPress : Mod
    {
        public override string Id => "auto.signal";
        public override string Name => "Press when ready";
        public override string Description => "Presses your key whenever the machine you are looking at is ready for another round.";
        public override Category Cat => Category.Automation;
        public override Authority Auth => Authority.SoloOnly;
        public override string[] Tags => new[] { "auto", "signal", "press", "win", "react", "trigger" };

        private KeyOption _key;
        private FloatOption _cooldown;
        private FloatOption _delay;
        private int _presses;
        private float _readyAt;
        private float _fireAt = -1f;

        protected override void Build()
        {
            _key = Opt(new KeyOption("auto.signal.key", "Key to press", KeyCode.E));
            _delay = Opt(new FloatOption("auto.signal.delay", "Wait before pressing", 0.15f, 0f, 3f,
                "A human-looking pause. Zero reacts instantly, which no person does.")
            { Step = 0.05f, Format = "0.00", Unit = "s" });
            _cooldown = Opt(new FloatOption("auto.signal.cooldown", "Rest after pressing", 2f, 0.2f, 20f)
            { Step = 0.1f, Format = "0.0", Unit = "s" });
        }

        protected override void OnEnable()
        {
            _presses = 0;
            _readyAt = 0f;
            _fireAt = -1f;

            if (!GameBridge.TGameBase.Ok)
                Notifier.Warn("This build does not expose GameBase, so there is no machine state to react to.");
        }

        protected override void OnDisable()
        {
            if (_presses > 0) Notifier.Info($"Signal presses stopped after {_presses}.");
        }

        protected override void OnUpdate()
        {
            if (MenuController.IsOpenNow) return;

            if (_fireAt > 0f && Time.unscaledTime >= _fireAt)
            {
                _fireAt = -1f;
                if (!Press.Send(_key.Value))
                {
                    Notifier.Error("This game's input backend cannot be driven from a mod — switching off.");
                    Enabled.Value = false;
                    return;
                }
                _presses++;
                _readyAt = Time.unscaledTime + _cooldown.Value;
                return;
            }

            if (Time.unscaledTime < _readyAt || _fireAt > 0f) return;

            // Fire when the machine you are looking at is idle and therefore ready to start.
            // Reading isPlaying off the machine beats inferring readiness from the balance:
            // it is the same flag the game's own interaction check uses.
            if (!Ready()) return;
            _fireAt = Time.unscaledTime + _delay.Value;
        }

        /// <summary>True when the aimed machine exists and is not mid-round.</summary>
        private bool Ready()
        {
            if (!GameBridge.TGameBase.Ok || !GameBridge.GbIsPlaying.Ok) return false;

            var cam = Camera.main;
            if (cam == null) return false;
            if (!Physics.Raycast(cam.transform.position, cam.transform.forward, out RaycastHit hit, 5f)) return false;
            if (hit.collider == null) return false;

            var machine = hit.collider.GetComponentInParent(GameBridge.TGameBase.Type) as Component;
            if (machine == null) return false;

            return GameBridge.GbIsPlaying.Get(machine) is bool playing && !playing;
        }

        protected override void OnDrawOverlay() => Hud.Line($"signal    armed · {_presses} press(es)");
    }

    /// <summary>
    /// Plays a fixed sequence of keys on a loop.
    ///
    /// Where the single auto-press covers "hit one button repeatedly", this covers a round that
    /// takes several in order — place, confirm, collect — without hard-coding any one game's flow.
    /// </summary>
    internal sealed class KeySequence : Mod
    {
        public override string Id => "auto.sequence";
        public override string Name => "Key sequence";
        public override string Description => "Repeats a list of keys with delays, for rounds that need more than one button.";
        public override Category Cat => Category.Automation;
        public override Authority Auth => Authority.SoloOnly;
        public override string[] Tags => new[] { "macro", "sequence", "auto", "loop", "keys", "afk" };

        private StringOption _script;
        private FloatOption _restart;
        private BoolOption _loop;

        private readonly List<(KeyCode key, float wait)> _steps = new List<(KeyCode, float)>();
        private int _step;
        private float _nextAt;
        private int _cycles;
        private string _parseError;

        protected override void Build()
        {
            _script = Opt(new StringOption("auto.sequence.script", "Sequence", "E 1.0, Space 0.5",
                "A key, then the seconds to wait after it, separated by commas.")
            { Placeholder = "E 1.0, Space 0.5" });
            _restart = Opt(new FloatOption("auto.sequence.restart", "Pause between runs", 1f, 0f, 30f)
            { Step = 0.5f, Format = "0.0", Unit = "s" });
            _loop = Opt(new BoolOption("auto.sequence.loop", "Repeat forever", true,
                "Off runs the sequence once, then switches itself off."));

            _script.Changed += Parse;
        }

        /// <summary>Turns the text into steps, naming the first bad token rather than quietly
        /// running a shorter sequence than the one that was written.</summary>
        private void Parse()
        {
            _steps.Clear();
            _parseError = null;

            foreach (var part in (_script.Value ?? "").Split(','))
            {
                string text = part.Trim();
                if (text.Length == 0) continue;

                var bits = text.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                if (!Enum.TryParse(bits[0], true, out KeyCode key))
                {
                    _parseError = $"'{bits[0]}' is not a key name.";
                    return;
                }

                float wait = 1f;
                if (bits.Length > 1 && !float.TryParse(bits[1], System.Globalization.NumberStyles.Float,
                                                       System.Globalization.CultureInfo.InvariantCulture, out wait))
                {
                    _parseError = $"'{bits[1]}' is not a number of seconds.";
                    return;
                }
                _steps.Add((key, Mathf.Max(0.02f, wait)));
            }

            if (_steps.Count == 0) _parseError = "The sequence is empty.";
        }

        protected override void OnEnable()
        {
            Parse();
            if (_parseError != null)
            {
                Notifier.Error(_parseError);
                Enabled.Value = false;
                return;
            }
            _step = 0;
            _cycles = 0;
            _nextAt = Time.unscaledTime;
        }

        protected override void OnDisable()
        {
            if (_cycles > 0) Notifier.Info($"Sequence stopped after {_cycles} run(s).");
        }

        protected override void OnUpdate()
        {
            if (MenuController.IsOpenNow || _steps.Count == 0) return;
            if (Time.unscaledTime < _nextAt) return;

            var step = _steps[_step];
            if (!Press.Send(step.key))
            {
                Notifier.Error("This game's input backend cannot be driven from a mod — switching off.");
                Enabled.Value = false;
                return;
            }

            _nextAt = Time.unscaledTime + step.wait;
            _step++;

            if (_step < _steps.Count) return;

            _step = 0;
            _cycles++;
            _nextAt += _restart.Value;

            if (!_loop.Value)
            {
                Notifier.Success("Sequence finished.");
                Enabled.Value = false;
            }
        }

        protected override void OnDrawOverlay()
            => Hud.Line($"sequence  step {_step + 1}/{_steps.Count} · {_cycles} run(s)");
    }
}
