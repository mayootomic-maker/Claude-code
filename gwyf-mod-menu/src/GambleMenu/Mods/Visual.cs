using System.Collections.Generic;
using System.Globalization;
using GambleMenu.Core;
using GambleMenu.UI;
using UnityEngine;
using Object = UnityEngine.Object;

namespace GambleMenu.Mods
{
    internal sealed class Fullbright : Mod
    {
        public override string Id => "visual.fullbright";
        public override string Name => "Fullbright";
        public override string Description => "Floods the scene with ambient light so nothing is hidden in shadow.";
        public override Category Cat => Category.Visual;
        public override string[] Tags => new[] { "light", "bright", "dark", "ambient", "see" };

        private FloatOption _intensity;
        private Color _prevAmbient;
        private UnityEngine.Rendering.AmbientMode _prevMode;
        private float _prevIntensity;

        protected override void Build()
        {
            _intensity = Opt(new FloatOption("visual.fullbright.level", "Brightness", 0.75f, 0.1f, 2f)
            { Step = 0.05f, Format = "0.00" });
            _intensity.Changed += Apply;
        }

        protected override void OnEnable()
        {
            _prevAmbient = RenderSettings.ambientLight;
            _prevMode = RenderSettings.ambientMode;
            _prevIntensity = RenderSettings.ambientIntensity;
            Apply();
        }

        private void Apply()
        {
            if (!Enabled.Value) return;
            // Flat mode is the only one where ambientLight is read directly; leaving the
            // scene on Skybox mode makes the colour below do nothing at all.
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(_intensity.Value, _intensity.Value, _intensity.Value, 1f);
            RenderSettings.ambientIntensity = 1f;
        }

        protected override void OnDisable()
        {
            RenderSettings.ambientMode = _prevMode;
            RenderSettings.ambientLight = _prevAmbient;
            RenderSettings.ambientIntensity = _prevIntensity;
        }
    }

    internal sealed class NoFog : Mod
    {
        public override string Id => "visual.nofog";
        public override string Name => "Remove fog";
        public override string Description => "Turns off distance fog so far corners of the floor stay readable.";
        public override Category Cat => Category.Visual;
        public override string[] Tags => new[] { "fog", "haze", "distance", "clear" };

        private bool _previous;

        protected override void OnEnable()
        {
            _previous = RenderSettings.fog;
            RenderSettings.fog = false;
        }

        protected override void OnDisable() => RenderSettings.fog = _previous;
    }

    internal sealed class FieldOfView : Mod
    {
        public override string Id => "visual.fov";
        public override string Name => "Field of view";
        public override string Description => "Widens or narrows the camera. Re-applied each frame in case the game resets it.";
        public override Category Cat => Category.Visual;
        public override string[] Tags => new[] { "fov", "camera", "zoom", "wide", "view" };

        private FloatOption _fov;
        private float _previous = -1f;

        protected override void Build()
        {
            _fov = Opt(new FloatOption("visual.fov.value", "FOV", 80f, 40f, 130f) { Step = 1f, Format = "0", Unit = "°" });
        }

        protected override void OnEnable()
        {
            var cam = Camera.main;
            if (cam == null) { Notifier.Warn("No main camera found yet."); return; }
            _previous = cam.fieldOfView;
        }

        protected override void OnUpdate()
        {
            var cam = Camera.main;
            if (cam == null) return;
            if (_previous < 0f) _previous = cam.fieldOfView;
            if (!Mathf.Approximately(cam.fieldOfView, _fov.Value)) cam.fieldOfView = _fov.Value;
        }

        protected override void OnDisable()
        {
            var cam = Camera.main;
            if (cam != null && _previous > 0f) cam.fieldOfView = _previous;
            _previous = -1f;
        }
    }

    /// <summary>
    /// Marks other players through walls.
    ///
    /// Remote players are found through Mirror rather than by prefab name: every player object
    /// carries a NetworkIdentity, and the one that is not ours is by definition somebody else.
    /// The scan is throttled because FindObjectsOfType every frame on a populated floor is a
    /// measurable frame-time cost for information that changes slowly.
    /// </summary>
    internal sealed class PlayerEsp : Mod
    {
        public override string Id => "visual.playeresp";
        public override string Name => "Player markers";
        public override string Description => "Shows where the others are, through walls, with distance.";
        public override Category Cat => Category.Visual;
        public override string[] Tags => new[] { "esp", "players", "wallhack", "friends", "markers" };
        public override Binding[] Requires => new Binding[] { GameBridge.TNetworkIdent };

        private ColorOption _color;
        private BoolOption _showDistance;
        private BoolOption _showBox;
        private FloatOption _maxDistance;

        private readonly List<GameObject> _targets = new List<GameObject>();
        private float _nextScan;

        protected override void Build()
        {
            _color = Opt(new ColorOption("visual.playeresp.color", "Marker colour", new Color(0.36f, 0.78f, 0.55f, 1f)));
            _showDistance = Opt(new BoolOption("visual.playeresp.dist", "Show distance", true));
            _showBox = Opt(new BoolOption("visual.playeresp.box", "Draw a box", true));
            _maxDistance = Opt(new FloatOption("visual.playeresp.max", "Hide beyond", 120f, 10f, 500f)
            { Step = 5f, Format = "0", Unit = "m" });
        }

        protected override void OnEnable()
        {
            _nextScan = 0f;
            _targets.Clear();
        }

        protected override void OnUpdate()
        {
            if (Time.unscaledTime < _nextScan) return;
            _nextScan = Time.unscaledTime + 1f;

            _targets.Clear();
            var local = GameBridge.LocalPlayer();

            try
            {
                foreach (var identity in Object.FindObjectsOfType(GameBridge.TNetworkIdent.Type))
                {
                    if (!(identity is Component c) || c == null) continue;
                    var go = c.gameObject;
                    if (go == null || (local != null && go == local)) continue;
                    // A player is the networked thing that walks: a controller or a rigidbody
                    // separates them from the networked machines and props.
                    if (go.GetComponent<CharacterController>() == null && go.GetComponent<Rigidbody>() == null) continue;
                    _targets.Add(go);
                }
            }
            catch (System.Exception ex)
            {
                Log.Warn($"player scan failed: {ex.Message}");
            }
        }

        protected override void OnDrawOverlay()
        {
            var cam = Camera.main;
            if (cam == null) return;
            var origin = cam.transform.position;

            foreach (var target in _targets)
            {
                if (target == null) continue;
                var pos = target.transform.position;
                float distance = Vector3.Distance(origin, pos);
                if (distance > _maxDistance.Value) continue;

                if (_showBox.Value)
                {
                    var bounds = new Bounds(pos + Vector3.up, new Vector3(0.9f, 2f, 0.9f));
                    Hud.Box(cam, bounds, _color.Value);
                }

                if (!Hud.Project(cam, pos + Vector3.up * 2.1f, out Vector2 screen)) continue;
                Hud.Marker(screen, target.name, _color.Value, _showDistance.Value ? distance : 0f);
            }
        }
    }

    internal sealed class RunHud : Mod
    {
        public override string Id => "visual.runhud";
        public override string Name => "Run readout";
        public override string Description => "Bank, quota, floor and time left, on screen at all times.";
        public override Category Cat => Category.Visual;
        public override string[] Tags => new[] { "hud", "money", "quota", "overlay", "readout", "timer" };

        private BoolOption _money, _quota, _floor, _timer, _shortfall;

        protected override void Build()
        {
            _money = Opt(new BoolOption("visual.runhud.money", "Bank balance", true));
            _quota = Opt(new BoolOption("visual.runhud.quota", "Today's quota", true));
            _shortfall = Opt(new BoolOption("visual.runhud.short", "Still needed", true,
                "Quota minus balance — what the table still owes the loan shark."));
            _floor = Opt(new BoolOption("visual.runhud.floor", "Floor", true));
            _timer = Opt(new BoolOption("visual.runhud.timer", "Time left", true));
        }

        protected override void OnDrawOverlay()
        {
            long? money = RunState.Money;
            long? quota = RunState.Quota;

            if (_money.Value && money.HasValue)
                Hud.Line($"bank    {money.Value.ToString("N0", CultureInfo.InvariantCulture)}");

            if (_quota.Value && quota.HasValue)
                Hud.Line($"quota   {quota.Value.ToString("N0", CultureInfo.InvariantCulture)}");

            if (_shortfall.Value && money.HasValue && quota.HasValue)
            {
                long left = quota.Value - money.Value;
                Hud.Line(left <= 0
                    ? "needed  covered"
                    : $"needed  {left.ToString("N0", CultureInfo.InvariantCulture)}");
            }

            if (_floor.Value)
            {
                int? floor = RunState.Floor;
                int? top = RunState.TopFloor;
                if (floor.HasValue)
                    Hud.Line(top.HasValue ? $"floor   {floor.Value} / {top.Value}" : $"floor   {floor.Value}");
            }

            if (_timer.Value && GameBridge.DayTimer.Ok)
            {
                var gm = GameBridge.Instance(GameBridge.TGameManager);
                if (gm != null)
                {
                    object raw = GameBridge.DayTimer.Get(gm);
                    if (raw != null)
                    {
                        try
                        {
                            float seconds = System.Convert.ToSingle(raw);
                            Hud.Line($"time    {Mathf.FloorToInt(seconds / 60f)}:{Mathf.FloorToInt(seconds % 60f):00}");
                        }
                        catch { /* an unexpected timer type just omits the line */ }
                    }
                }
            }
        }
    }

    internal sealed class Crosshair : Mod
    {
        public override string Id => "visual.crosshair";
        public override string Name => "Crosshair";
        public override string Description => "A dot in the middle of the screen, for lining up interactions.";
        public override Category Cat => Category.Visual;
        public override string[] Tags => new[] { "crosshair", "dot", "centre", "aim" };

        private ColorOption _color;
        private FloatOption _size;
        private EnumOption _shape;

        protected override void Build()
        {
            _shape = Opt(new EnumOption("visual.crosshair.shape", "Shape", new[] { "Dot", "Cross", "Ring" }, 0));
            _size = Opt(new FloatOption("visual.crosshair.size", "Size", 4f, 1f, 20f) { Step = 0.5f, Format = "0.#" });
            _color = Opt(new ColorOption("visual.crosshair.color", "Colour", new Color(1f, 1f, 1f, 0.85f)));
        }

        protected override void OnDrawOverlay()
        {
            float cx = Screen.width * 0.5f;
            float cy = Screen.height * 0.5f;
            float s = _size.Value;

            switch (_shape.Index)
            {
                case 1:
                    Draw.Fill(new Rect(cx - s * 2f, cy - 0.75f, s * 4f, 1.5f), _color.Value);
                    Draw.Fill(new Rect(cx - 0.75f, cy - s * 2f, 1.5f, s * 4f), _color.Value);
                    break;
                case 2:
                    Draw.Outline(new Rect(cx - s, cy - s, s * 2f, s * 2f), _color.Value, s, 1.5f);
                    break;
                default:
                    Draw.Round(new Rect(cx - s * 0.5f, cy - s * 0.5f, s, s), _color.Value, s * 0.5f);
                    break;
            }
        }
    }
}

namespace GambleMenu.Mods
{
    /// <summary>
    /// Marks scene objects whose name matches a filter.
    ///
    /// Which machines and pickups exist is not something this plugin knows, so rather than
    /// ship a guessed list this takes the name filter from the user — run the scene dump in
    /// the Developer tab, find what the objects are actually called, and type a fragment here.
    /// </summary>
    internal sealed class ObjectFinder : Mod
    {
        public override string Id => "visual.objectesp";
        public override string Name => "Object finder";
        public override string Description => "Marks anything in the level whose name matches your filter.";
        public override Category Cat => Category.Visual;
        public override string[] Tags => new[] { "esp", "items", "machines", "find", "search", "highlight" };

        private StringOption _filter;
        private ColorOption _color;
        private FloatOption _maxDistance;
        private BoolOption _showDistance;
        private IntOption _limit;

        private readonly List<Transform> _found = new List<Transform>();
        private float _nextScan;

        protected override void Build()
        {
            _filter = Opt(new StringOption("visual.objectesp.filter", "Name contains", "",
                "Case-insensitive. Dump the scene components first to learn the real names.")
            { Placeholder = "slot" });
            _color = Opt(new ColorOption("visual.objectesp.color", "Marker colour", new Color(0.91f, 0.71f, 0.30f, 1f)));
            _maxDistance = Opt(new FloatOption("visual.objectesp.max", "Hide beyond", 60f, 5f, 300f)
            { Step = 5f, Format = "0", Unit = "m" });
            _showDistance = Opt(new BoolOption("visual.objectesp.dist", "Show distance", true));
            _limit = Opt(new IntOption("visual.objectesp.limit", "Most markers at once", 40, 5, 200,
                "A filter that matches half the level would otherwise cover the screen."));
        }

        protected override void OnEnable()
        {
            _nextScan = 0f;
            _found.Clear();
            if (string.IsNullOrEmpty(_filter.Value?.Trim()))
                Notifier.Info("Object finder is on, but the name filter is empty — nothing will be marked.");
        }

        protected override void OnUpdate()
        {
            if (Time.unscaledTime < _nextScan) return;
            _nextScan = Time.unscaledTime + 2f;

            _found.Clear();
            string filter = _filter.Value?.Trim();
            if (string.IsNullOrEmpty(filter)) return;

            try
            {
                // Renderers rather than every Transform: a marker on something with no visible
                // geometry is a marker on nothing the player can find.
                foreach (var renderer in Object.FindObjectsOfType<Renderer>())
                {
                    if (renderer == null) continue;
                    if (renderer.name.IndexOf(filter, System.StringComparison.OrdinalIgnoreCase) < 0) continue;
                    _found.Add(renderer.transform);
                    if (_found.Count >= _limit.Value) break;
                }
            }
            catch (System.Exception ex)
            {
                Log.Warn($"object scan failed: {ex.Message}");
            }
        }

        protected override void OnDrawOverlay()
        {
            var cam = Camera.main;
            if (cam == null) return;
            var origin = cam.transform.position;

            foreach (var t in _found)
            {
                if (t == null) continue;
                float distance = Vector3.Distance(origin, t.position);
                if (distance > _maxDistance.Value) continue;
                if (!Hud.Project(cam, t.position, out Vector2 screen)) continue;
                Hud.Marker(screen, t.name, _color.Value, _showDistance.Value ? distance : 0f);
            }
        }
    }
}
