using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using GambleMenu.Core;
using GambleMenu.UI;
using UnityEngine;
using UnityEngine.Rendering;
using Object = UnityEngine.Object;

namespace GambleMenu.Mods
{
    /// <summary>
    /// Trades image quality for frame rate, and puts everything back when switched off.
    ///
    /// Every lever here is local rendering state — nothing touches simulation, so this is safe
    /// in a lobby and safe as a guest. Notably absent is fixedDeltaTime, which is the cheapest
    /// way to buy frames and the one that must not be used here: it changes how often physics
    /// steps, which on a host changes the simulation everyone else is synchronised to.
    ///
    /// Originals are captured on enable and restored on disable. Without that, a player who
    /// tried this once would be left with shadows off and quarter-resolution textures in every
    /// session afterwards, with nothing to point at as the cause.
    /// </summary>
    internal sealed class Performance : Mod
    {
        public override string Id => "perf.boost";
        public override string Name => "Performance boost";
        public override string Description => "Turns down what costs the most frames. Everything is restored when you switch this off.";
        public override Category Cat => Category.Performance;
        public override Authority Auth => Authority.Anywhere;
        public override string[] Tags => new[] { "fps", "performance", "boost", "speed", "lag", "stutter", "quality", "optimise", "optimize" };

        private EnumOption _preset;
        private BoolOption _shadows, _vsync, _uncap, _postProcessing, _reflections, _softParticles, _antiAliasing;
        private IntOption _textureLimit;
        private FloatOption _renderScale, _lodBias, _viewDistance;

        // --- captured originals
        private bool _captured;
        private int _oVSync, _oTextureLimit, _oAntiAliasing, _oShadowCascades, _oParticleBudget, _oTargetFps;
        private float _oShadowDistance, _oLodBias, _oFarClip, _oRenderScale = -1f;
        private ShadowQuality _oShadows;
        private bool _oSoftParticles, _oReflectionProbes;
        private readonly List<Behaviour> _disabledVolumes = new List<Behaviour>();

        private float _fpsAccum;
        private int _fpsFrames;
        private float _fpsShown;
        private float _nextFpsUpdate;

        protected override void Build()
        {
            _preset = Opt(new EnumOption("perf.preset", "Preset",
                new[] { "Light", "Balanced", "Aggressive", "Custom" }, 1,
                "Light barely changes how it looks. Aggressive will look worse and run a lot faster."));
            _preset.Changed += ApplyPreset;

            _shadows = Opt(new BoolOption("perf.shadows", "Turn off shadows", true,
                "Usually the single biggest win in a Unity game."));
            _vsync = Opt(new BoolOption("perf.vsync", "Turn off VSync", true,
                "Removes the cap at your monitor's refresh rate. May introduce tearing."));
            _uncap = Opt(new BoolOption("perf.uncap", "Remove the frame cap", true,
                "Some games cap themselves below what your machine can do."));
            _postProcessing = Opt(new BoolOption("perf.post", "Turn off post-processing", true,
                "Bloom, colour grading, vignette. Cheap to disable, and the look changes noticeably."));
            _reflections = Opt(new BoolOption("perf.reflections", "Turn off live reflections", true));
            _softParticles = Opt(new BoolOption("perf.softparticles", "Turn off soft particles", true));
            _antiAliasing = Opt(new BoolOption("perf.aa", "Turn off anti-aliasing", true,
                "Edges get jagged; costs nothing to try."));

            _textureLimit = Opt(new IntOption("perf.textures", "Texture detail drop", 1, 0, 3,
                "0 keeps full resolution. Each step halves it, which helps most when video memory is the limit."));
            _renderScale = Opt(new FloatOption("perf.renderscale", "Render scale", 0.85f, 0.4f, 1f,
                "Renders below your display resolution and scales up. The strongest lever here, and the most visible.")
            { Step = 0.05f, Format = "0.00", Unit = "×" });
            _lodBias = Opt(new FloatOption("perf.lodbias", "Detail distance", 0.7f, 0.2f, 2f,
                "Below 1 swaps to simpler models sooner.") { Step = 0.05f, Format = "0.00", Unit = "×" });
            _viewDistance = Opt(new FloatOption("perf.viewdistance", "View distance", 1f, 0.2f, 1f,
                "Fraction of the camera's normal far clip. Below 1 stops drawing distant geometry.")
            { Step = 0.05f, Format = "0.00", Unit = "×" });

            foreach (var o in Options) o.Changed += () => { if (Enabled.Value) Apply(); };

            Act("Re-apply now", () => { if (Enabled.Value) Apply(); },
                "Some games reset quality settings when a scene loads; this puts yours back.");
        }

        private void ApplyPreset()
        {
            switch (_preset.Index)
            {
                case 0: // Light — nothing that changes the look much
                    _shadows.Value = false; _postProcessing.Value = false; _antiAliasing.Value = true;
                    _reflections.Value = true; _softParticles.Value = true;
                    _textureLimit.Value = 0; _renderScale.Value = 1f; _lodBias.Value = 1f; _viewDistance.Value = 1f;
                    break;
                case 1: // Balanced
                    _shadows.Value = true; _postProcessing.Value = true; _antiAliasing.Value = true;
                    _reflections.Value = true; _softParticles.Value = true;
                    _textureLimit.Value = 1; _renderScale.Value = 0.85f; _lodBias.Value = 0.7f; _viewDistance.Value = 1f;
                    break;
                case 2: // Aggressive
                    _shadows.Value = true; _postProcessing.Value = true; _antiAliasing.Value = true;
                    _reflections.Value = true; _softParticles.Value = true;
                    _textureLimit.Value = 2; _renderScale.Value = 0.65f; _lodBias.Value = 0.4f; _viewDistance.Value = 0.6f;
                    break;
                // Custom leaves whatever the user set.
            }
            if (Enabled.Value) Apply();
        }

        // --- apply / restore --------------------------------------------------------

        protected override void OnEnable()
        {
            Capture();
            Apply();
            Notifier.Success("Performance boost on. Switch it off to put everything back.");
        }

        private void Capture()
        {
            if (_captured) return;
            _captured = true;

            _oVSync = QualitySettings.vSyncCount;
            _oShadows = QualitySettings.shadows;
            _oShadowDistance = QualitySettings.shadowDistance;
            _oShadowCascades = QualitySettings.shadowCascades;
            _oTextureLimit = QualitySettings.masterTextureLimit;
            _oAntiAliasing = QualitySettings.antiAliasing;
            _oLodBias = QualitySettings.lodBias;
            _oSoftParticles = QualitySettings.softParticles;
            _oReflectionProbes = QualitySettings.realtimeReflectionProbes;
            _oParticleBudget = QualitySettings.particleRaycastBudget;
            _oTargetFps = Application.targetFrameRate;

            var cam = Camera.main;
            _oFarClip = cam != null ? cam.farClipPlane : -1f;
            _oRenderScale = ReadRenderScale();
        }

        private void Apply()
        {
            try
            {
                if (_vsync.Value) QualitySettings.vSyncCount = 0;
                if (_uncap.Value) Application.targetFrameRate = -1;

                if (_shadows.Value)
                {
                    QualitySettings.shadows = ShadowQuality.Disable;
                    QualitySettings.shadowDistance = 0f;
                    QualitySettings.shadowCascades = 0;
                }

                if (_antiAliasing.Value) QualitySettings.antiAliasing = 0;
                if (_softParticles.Value) QualitySettings.softParticles = false;
                if (_reflections.Value) QualitySettings.realtimeReflectionProbes = false;

                QualitySettings.masterTextureLimit = _textureLimit.Value;
                QualitySettings.lodBias = _lodBias.Value;
                QualitySettings.particleRaycastBudget = Mathf.Max(4, _oParticleBudget / 4);

                if (_viewDistance.Value < 0.999f && _oFarClip > 0f)
                {
                    var cam = Camera.main;
                    if (cam != null) cam.farClipPlane = _oFarClip * _viewDistance.Value;
                }

                WriteRenderScale(_renderScale.Value);
                if (_postProcessing.Value) DisableVolumes();
            }
            catch (Exception ex)
            {
                Log.Warn($"performance settings partly refused: {ex.Message}");
            }
        }

        protected override void OnDisable()
        {
            if (!_captured) return;
            try
            {
                QualitySettings.vSyncCount = _oVSync;
                QualitySettings.shadows = _oShadows;
                QualitySettings.shadowDistance = _oShadowDistance;
                QualitySettings.shadowCascades = _oShadowCascades;
                QualitySettings.masterTextureLimit = _oTextureLimit;
                QualitySettings.antiAliasing = _oAntiAliasing;
                QualitySettings.lodBias = _oLodBias;
                QualitySettings.softParticles = _oSoftParticles;
                QualitySettings.realtimeReflectionProbes = _oReflectionProbes;
                QualitySettings.particleRaycastBudget = _oParticleBudget;
                Application.targetFrameRate = _oTargetFps;

                var cam = Camera.main;
                if (cam != null && _oFarClip > 0f) cam.farClipPlane = _oFarClip;

                if (_oRenderScale > 0f) WriteRenderScale(_oRenderScale);

                foreach (var v in _disabledVolumes)
                    if (v != null) v.enabled = true;
                _disabledVolumes.Clear();
            }
            catch (Exception ex)
            {
                Log.Error($"could not fully restore graphics settings: {ex.Message}");
                Notifier.Warn("Some graphics settings could not be restored — a game restart will clear them.");
            }
            _captured = false;
        }

        /// <summary>
        /// Turns off post-processing volumes.
        ///
        /// Found by type name through reflection rather than by referencing URP: the package is
        /// not guaranteed to be present, and a hard reference would stop the whole plugin
        /// loading in a game that renders through the built-in pipeline instead.
        /// </summary>
        private void DisableVolumes()
        {
            var volumeType = FindType("UnityEngine.Rendering.Volume");
            if (volumeType == null) return;

            try
            {
                foreach (var v in Object.FindObjectsOfType(volumeType))
                {
                    if (!(v is Behaviour b) || b == null || !b.enabled) continue;
                    b.enabled = false;
                    _disabledVolumes.Add(b);
                }
            }
            catch (Exception ex) { Log.Warn($"could not disable post-processing: {ex.Message}"); }
        }

        // --- render scale (URP, by reflection) --------------------------------------

        private static object CurrentPipelineAsset()
        {
            try
            {
                var gs = typeof(GraphicsSettings);
                var prop = gs.GetProperty("currentRenderPipeline", BindingFlags.Public | BindingFlags.Static)
                        ?? gs.GetProperty("renderPipelineAsset", BindingFlags.Public | BindingFlags.Static);
                return prop?.GetValue(null);
            }
            catch { return null; }
        }

        private static float ReadRenderScale()
        {
            var asset = CurrentPipelineAsset();
            if (asset == null) return -1f;
            try
            {
                var p = asset.GetType().GetProperty("renderScale");
                if (p == null) return -1f;
                return Convert.ToSingle(p.GetValue(asset));
            }
            catch { return -1f; }
        }

        private static void WriteRenderScale(float value)
        {
            var asset = CurrentPipelineAsset();
            if (asset == null) return;
            try
            {
                var p = asset.GetType().GetProperty("renderScale");
                if (p == null || !p.CanWrite) return;
                p.SetValue(asset, Mathf.Clamp(value, 0.1f, 2f));
            }
            catch (Exception ex) { Log.Warn($"render scale refused: {ex.Message}"); }
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
                catch { }
            }
            return null;
        }

        // --- readout ----------------------------------------------------------------

        protected override void OnUpdate()
        {
            _fpsAccum += 1f / Mathf.Max(0.0001f, Time.unscaledDeltaTime);
            _fpsFrames++;

            if (Time.unscaledTime < _nextFpsUpdate) return;
            _nextFpsUpdate = Time.unscaledTime + 0.5f;
            _fpsShown = _fpsFrames > 0 ? _fpsAccum / _fpsFrames : 0f;
            _fpsAccum = 0f;
            _fpsFrames = 0;
        }

        protected override void OnDrawOverlay()
        {
            Hud.Line($"fps     {_fpsShown.ToString("0", CultureInfo.InvariantCulture)}   ({_preset.Selected.ToLowerInvariant()})");
        }
    }
}
