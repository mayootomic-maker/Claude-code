using System.Collections.Generic;
using GambleMenu.Core;
using UnityEngine;

namespace GambleMenu.UI
{
    /// <summary>
    /// Per-widget animation state for an immediate-mode UI.
    ///
    /// IMGUI redraws from scratch every frame and keeps no widget objects, so hover and
    /// toggle transitions need somewhere to live between frames. Values are keyed by a
    /// caller-supplied string and smoothed on unscaled time — scaled time would freeze every
    /// transition the moment a mod sets the game's time scale to zero.
    /// </summary>
    internal static class Anim
    {
        private static readonly Dictionary<string, float> _values = new Dictionary<string, float>();
        private static float _lastStep;
        private static float _dt;

        /// <summary>Call once per frame before any widget draws.</summary>
        public static void BeginFrame()
        {
            float now = Time.unscaledTime;
            _dt = _lastStep <= 0f ? 0f : Mathf.Clamp(now - _lastStep, 0f, 0.1f);
            _lastStep = now;
        }

        /// <summary>Eases the value stored at <paramref name="key"/> toward
        /// <paramref name="target"/> and returns it. With animations off it snaps.</summary>
        public static float To(string key, float target, float speed = 14f)
        {
            if (!Settings.Animations.Value) { _values[key] = target; return target; }

            if (!_values.TryGetValue(key, out float current)) current = target;
            // Frame-rate independent exponential approach; at 14/s a transition reads as
            // roughly 150 ms, which is quick enough not to feel laggy when clicking fast.
            float t = 1f - Mathf.Exp(-speed * _dt);
            current = Mathf.Lerp(current, target, t);
            if (Mathf.Abs(current - target) < 0.001f) current = target;
            _values[key] = current;
            return current;
        }

        public static void Set(string key, float value) => _values[key] = value;

        public static void Forget(string key) => _values.Remove(key);

        public static void Clear() => _values.Clear();

        public static float EaseOutCubic(float t) { t = Mathf.Clamp01(t); float u = 1f - t; return 1f - u * u * u; }

        public static float EaseOutBack(float t)
        {
            t = Mathf.Clamp01(t);
            const float c1 = 1.70158f, c3 = c1 + 1f;
            float u = t - 1f;
            return 1f + c3 * u * u * u + c1 * u * u;
        }
    }
}
