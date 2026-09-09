using System;
using System.Collections.Generic;
using System.Reflection;
using UnityEngine;

namespace GambleMenu.Core
{
    /// <summary>
    /// Reads the keyboard without caring which input backend the game shipped with.
    ///
    /// Unity 6 projects frequently set active input handling to the Input System package
    /// alone, and in that configuration every <c>UnityEngine.Input</c> call throws
    /// InvalidOperationException — a mod menu bound to the legacy API simply never opens,
    /// with nothing in the log to explain it. The first throw here is caught once, latched,
    /// and every later read goes through the Input System by reflection instead.
    /// </summary>
    internal static class InputBridge
    {
        private enum Backend { Unknown, Legacy, InputSystem, None }

        private static Backend _backend = Backend.Unknown;

        private static object _keyboard;              // UnityEngine.InputSystem.Keyboard.current
        private static PropertyInfo _keyboardCurrent;
        private static PropertyInfo _indexer;         // Keyboard[Key] -> KeyControl
        private static PropertyInfo _wasPressed;      // KeyControl.wasPressedThisFrame
        private static PropertyInfo _isPressed;       // KeyControl.isPressed
        private static Type _keyEnum;

        private static readonly Dictionary<KeyCode, object> _controlCache = new Dictionary<KeyCode, object>();

        public static string BackendName
        {
            get
            {
                EnsureBackend();
                switch (_backend)
                {
                    case Backend.Legacy:      return "legacy Input";
                    case Backend.InputSystem: return "Input System";
                    case Backend.None:        return "unavailable";
                    default:                  return "detecting";
                }
            }
        }

        private static void EnsureBackend()
        {
            if (_backend != Backend.Unknown) return;
            try
            {
                // Probe with a real key. KeyCode.None was the original choice and it was
                // wrong: it is the one value the legacy API can answer without touching the
                // disabled input manager, so the probe passed on exactly the games where
                // every subsequent read would throw.
                Input.GetKeyDown(KeyCode.F13);
                _backend = Backend.Legacy;
                Log.Info("input backend: legacy UnityEngine.Input");
            }
            catch (Exception)
            {
                _backend = TryBindInputSystem() ? Backend.InputSystem : Backend.None;
                Log.Info($"input backend: {BackendNameRaw()}");
            }
        }

        private static string BackendNameRaw() =>
            _backend == Backend.InputSystem ? "Input System (legacy disabled)" : "none — hotkeys will not work";

        private static bool TryBindInputSystem()
        {
            try
            {
                var keyboardType = FindType("UnityEngine.InputSystem.Keyboard");
                _keyEnum = FindType("UnityEngine.InputSystem.Key");
                if (keyboardType == null || _keyEnum == null) return false;

                _keyboardCurrent = keyboardType.GetProperty("current", BindingFlags.Public | BindingFlags.Static);
                _indexer = keyboardType.GetProperty("Item", new[] { _keyEnum });
                if (_keyboardCurrent == null || _indexer == null) return false;

                var controlType = FindType("UnityEngine.InputSystem.Controls.ButtonControl")
                                  ?? FindType("UnityEngine.InputSystem.Controls.KeyControl");
                if (controlType == null) return false;

                _wasPressed = controlType.GetProperty("wasPressedThisFrame");
                _isPressed  = controlType.GetProperty("isPressed");
                return _wasPressed != null && _isPressed != null;
            }
            catch (Exception ex)
            {
                Log.Warn($"Input System bind failed: {ex.Message}");
                return false;
            }
        }

        private static Type FindType(string fullName)
        {
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                try
                {
                    var t = asm.GetType(fullName, false);
                    if (t != null) return t;
                }
                catch { /* dynamic assemblies can refuse GetType; skip them */ }
            }
            return null;
        }

        public static bool GetKeyDown(KeyCode key)
        {
            if (key == KeyCode.None) return false;
            EnsureBackend();
            switch (_backend)
            {
                case Backend.Legacy:
                    try { return Input.GetKeyDown(key); }
                    catch (Exception ex) { return Demote(ex, key, _wasPressed); }
                case Backend.InputSystem:
                    return ReadControl(key, _wasPressed);
                default:
                    return false;
            }
        }

        /// <summary>
        /// Handles the legacy API throwing after we decided it worked.
        ///
        /// The original code caught this and returned false, forever and in silence — so a
        /// game with legacy input disabled produced a menu whose key did nothing, with not a
        /// line in the log to say why. Re-detecting once and saying so out loud is the whole
        /// difference between a bug report and a mystery.
        /// </summary>
        private static bool Demote(Exception ex, KeyCode key, PropertyInfo prop)
        {
            Log.Warn($"legacy input threw ({ex.GetType().Name}: {ex.Message}) — switching to the Input System");
            _backend = TryBindInputSystem() ? Backend.InputSystem : Backend.None;
            Log.Info($"input backend is now: {BackendNameRaw()}");
            return _backend == Backend.InputSystem && ReadControl(key, prop);
        }

        public static bool GetKey(KeyCode key)
        {
            if (key == KeyCode.None) return false;
            EnsureBackend();
            switch (_backend)
            {
                case Backend.Legacy:
                    try { return Input.GetKey(key); }
                    catch (Exception ex) { return Demote(ex, key, _isPressed); }
                case Backend.InputSystem:
                    return ReadControl(key, _isPressed);
                default:
                    return false;
            }
        }

        private static bool ReadControl(KeyCode key, PropertyInfo prop)
        {
            try
            {
                var current = _keyboardCurrent.GetValue(null);
                if (current == null) return false;
                if (!ReferenceEquals(current, _keyboard)) { _keyboard = current; _controlCache.Clear(); }

                if (!_controlCache.TryGetValue(key, out var control))
                {
                    control = ResolveControl(key);
                    _controlCache[key] = control;
                }
                if (control == null) return false;
                return (bool)prop.GetValue(control);
            }
            catch { return false; }
        }

        private static object ResolveControl(KeyCode key)
        {
            string name = TranslateKeyName(key);
            if (name == null) return null;
            try
            {
                if (!Enum.IsDefined(_keyEnum, name)) return null;
                var value = Enum.Parse(_keyEnum, name);
                return _indexer.GetValue(_keyboard, new[] { value });
            }
            catch { return null; }
        }

        /// <summary>
        /// Maps a legacy KeyCode name onto the Input System's Key enum.
        ///
        /// Most names match outright; these are the ones that do not, and getting them wrong
        /// silently costs the user their keybind rather than erroring.
        /// </summary>
        private static string TranslateKeyName(KeyCode key)
        {
            switch (key)
            {
                case KeyCode.Return:       return "Enter";
                case KeyCode.KeypadEnter:  return "NumpadEnter";
                case KeyCode.Alpha0:       return "Digit0";
                case KeyCode.Alpha1:       return "Digit1";
                case KeyCode.Alpha2:       return "Digit2";
                case KeyCode.Alpha3:       return "Digit3";
                case KeyCode.Alpha4:       return "Digit4";
                case KeyCode.Alpha5:       return "Digit5";
                case KeyCode.Alpha6:       return "Digit6";
                case KeyCode.Alpha7:       return "Digit7";
                case KeyCode.Alpha8:       return "Digit8";
                case KeyCode.Alpha9:       return "Digit9";
                case KeyCode.LeftControl:  return "LeftCtrl";
                case KeyCode.RightControl: return "RightCtrl";
                case KeyCode.CapsLock:     return "CapsLock";
                case KeyCode.Print:        return "PrintScreen";
                case KeyCode.BackQuote:    return "Backquote";
                case KeyCode.Keypad0:      return "Numpad0";
                case KeyCode.Keypad1:      return "Numpad1";
                case KeyCode.Keypad2:      return "Numpad2";
                case KeyCode.Keypad3:      return "Numpad3";
                case KeyCode.Keypad4:      return "Numpad4";
                case KeyCode.Keypad5:      return "Numpad5";
                case KeyCode.Keypad6:      return "Numpad6";
                case KeyCode.Keypad7:      return "Numpad7";
                case KeyCode.Keypad8:      return "Numpad8";
                case KeyCode.Keypad9:      return "Numpad9";
                default:                   return key.ToString();
            }
        }

        /// <summary>Keys offered when rebinding. Mouse buttons and joystick codes are excluded
        /// because the Input System path cannot address them through the keyboard device.</summary>
        public static IEnumerable<KeyCode> BindableKeys()
        {
            foreach (KeyCode k in Enum.GetValues(typeof(KeyCode)))
            {
                string n = k.ToString();
                if (n.StartsWith("Mouse", StringComparison.Ordinal)) continue;
                if (n.StartsWith("Joystick", StringComparison.Ordinal)) continue;
                yield return k;
            }
        }
    }
}
