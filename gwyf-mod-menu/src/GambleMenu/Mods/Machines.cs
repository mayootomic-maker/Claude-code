using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using GambleMenu.Core;
using GambleMenu.UI;
using UnityEngine;
using Object = UnityEngine.Object;

namespace GambleMenu.Mods
{
    /// <summary>One field on a machine, and what it has been observed doing.</summary>
    internal sealed class TrackedField
    {
        public Component Owner;
        public FieldInfo Field;
        public string Text;
        public double? Numeric;
        public float LastChange;
        public int Changes;
        public int Samples;

        public string Label => Field.Name;

        /// <summary>Fraction of samples in which this field changed.</summary>
        public float ChangeRate => Samples == 0 ? 0f : Changes / (float)Samples;

        /// <summary>
        /// How likely this field is to be the one that matters.
        ///
        /// Name matching was the original approach and it is guesswork — every machine has a
        /// "value" and most of them are irrelevant. Observed behaviour is evidence instead:
        /// a field that never changes is scenery, and one that changes on every single sample
        /// is an animation or a clock, not an outcome. What is worth seeing sits between those,
        /// changing in discrete jumps, and having changed recently.
        /// </summary>
        public float Score(float now)
        {
            if (Changes == 0) return 0f;

            float rate = ChangeRate;
            if (rate > 0.6f) return 0.05f;              // continuous — a timer or a tween

            float recency = Mathf.Clamp01(1f - (now - LastChange) / 12f);
            float discreteness = 1f - Mathf.Abs(rate - 0.12f) / 0.6f;
            return Mathf.Clamp01(discreteness) * 0.55f + recency * 0.45f;
        }
    }

    /// <summary>A candidate machine: an object nearby carrying game code with live state.</summary>
    internal sealed class TrackedMachine
    {
        public GameObject Root;
        public Renderer[] Renderers;
        public readonly List<TrackedField> Fields = new List<TrackedField>();
        public float LastChange;

        public bool Alive => Root != null;

        public Bounds Bounds()
        {
            var b = new Bounds(Root.transform.position, Vector3.one * 0.4f);
            bool first = true;
            foreach (var r in Renderers)
            {
                if (r == null) continue;
                if (first) { b = r.bounds; first = false; }
                else b.Encapsulate(r.bounds);
            }
            return b;
        }
    }

    /// <summary>
    /// Marks machines in the world and shows what their state is doing.
    ///
    /// The first version of this printed a list of field names into the corner of the screen,
    /// which was neither accurate nor attached to anything — with two machines in view it told
    /// you nothing about which was which. This draws on the machines themselves, and picks what
    /// to show from observed behaviour rather than from field names, because a name is a guess
    /// and a change you watched happen is evidence.
    ///
    /// What it cannot do is tell you what a value *means*. That is what the signal rule below
    /// is for: once you can see which field moves when you play, you say what counts as good
    /// and the machine is marked accordingly.
    /// </summary>
    internal sealed class MachineMarkers : Mod
    {
        public override string Id => "machines.markers";
        public override string Name => "Machine markers";
        public override string Description => "Outlines machines in the world and shows the values that are actually moving.";
        public override Category Cat => Category.Machines;
        public override string[] Tags => new[] { "machine", "marker", "highlight", "outline", "esp", "slot", "automat", "press", "signal", "predict" };

        private const int MaxMachines = 10;
        private const int MaxFieldsPerMachine = 28;

        private FloatOption _radius;
        private BoolOption _aimedOnly;
        private IntOption _rows;
        private ColorOption _idleColour, _activeColour, _signalColour;
        private BoolOption _outline;

        private StringOption _signalField;
        private EnumOption _signalTest;
        private StringOption _signalValue;
        private StringOption _signalText;

        private readonly List<TrackedMachine> _machines = new List<TrackedMachine>();
        private float _nextScan, _nextSample;

        protected override void Build()
        {
            _radius = Opt(new FloatOption("machines.markers.radius", "Search radius", 12f, 2f, 60f,
                "Machines within this distance of you are tracked.") { Step = 1f, Format = "0", Unit = "m" });
            _aimedOnly = Opt(new BoolOption("machines.markers.aimed", "Only the one I am looking at", false,
                "On keeps the screen clear when a room is full of machines."));
            _rows = Opt(new IntOption("machines.markers.rows", "Values shown", 3, 0, 8,
                "How many of the moving values to list on each marker. Zero shows the outline only."));
            _outline = Opt(new BoolOption("machines.markers.outline", "Outline the machine", true));

            _idleColour = Opt(new ColorOption("machines.markers.idle", "Idle colour", new Color(0.55f, 0.60f, 0.68f, 0.55f)));
            _activeColour = Opt(new ColorOption("machines.markers.active", "Changing colour", new Color(0.91f, 0.71f, 0.30f, 1f)));
            _signalColour = Opt(new ColorOption("machines.markers.signal", "Signal colour", new Color(0.36f, 0.85f, 0.55f, 1f)));

            _signalField = Opt(new StringOption("machines.markers.sigfield", "Signal: field", "",
                "Name of the value to watch, from the list on the marker. Leave blank for no signal.")
            { Placeholder = "(none)" });
            _signalTest = Opt(new EnumOption("machines.markers.sigtest", "Signal: when",
                new[] { "is at least", "is at most", "equals", "changes" }, 0,
                "How the value is compared against the number below.")
            { VisibleWhen = () => !string.IsNullOrEmpty(_signalField.Value) });
            _signalValue = Opt(new StringOption("machines.markers.sigvalue", "Signal: value", "2",
                "Compared numerically when both sides are numbers, otherwise as text.")
            { VisibleWhen = () => !string.IsNullOrEmpty(_signalField.Value) && _signalTest.Index != 3 });
            _signalText = Opt(new StringOption("machines.markers.sigtext", "Signal: label", "PRESS",
                "Shown on the machine when the condition holds.")
            { VisibleWhen = () => !string.IsNullOrEmpty(_signalField.Value) });
        }

        protected override void OnEnable()
        {
            _machines.Clear();
            _nextScan = 0f;
            _nextSample = 0f;
        }

        protected override void OnDisable() => _machines.Clear();

        protected override void OnUpdate()
        {
            float now = Time.unscaledTime;
            if (now >= _nextScan) { _nextScan = now + 1.5f; Scan(); }
            if (now >= _nextSample) { _nextSample = now + 0.1f; Sample(now); }
        }

        // --- discovery --------------------------------------------------------------

        /// <summary>
        /// Finds nearby objects that carry game code.
        ///
        /// There is no list of machine class names to match against, and there does not need to
        /// be: scenery has no custom MonoBehaviour on it. Anything with a collider, a renderer
        /// and a script from the game's own assembly is a candidate, and the sampling below
        /// discards the ones whose state never moves.
        /// </summary>
        private void Scan()
        {
            var origin = GameBridge.LocalPlayer()?.transform.position
                         ?? Camera.main?.transform.position;
            if (!origin.HasValue) return;

            _machines.RemoveAll(m => !m.Alive ||
                                     Vector3.Distance(m.Root.transform.position, origin.Value) > _radius.Value * 1.4f);

            Collider[] hits;
            try { hits = Physics.OverlapSphere(origin.Value, _radius.Value); }
            catch (Exception ex) { Log.Warn($"machine scan failed: {ex.Message}"); return; }

            foreach (var hit in hits)
            {
                if (_machines.Count >= MaxMachines) break;
                if (hit == null) continue;

                var root = FindScriptedRoot(hit.gameObject);
                if (root == null) continue;
                if (_machines.Any(m => m.Root == root)) continue;

                var renderers = root.GetComponentsInChildren<Renderer>(false);
                if (renderers.Length == 0) continue;   // nothing to draw on

                var machine = new TrackedMachine { Root = root, Renderers = renderers };
                CollectFields(machine);
                if (machine.Fields.Count > 0) _machines.Add(machine);
            }
        }

        /// <summary>Walks up from a collider to the object that owns the game's own script.</summary>
        private static GameObject FindScriptedRoot(GameObject from)
        {
            var t = from.transform;
            int hops = 0;
            while (t != null && hops++ < 4)
            {
                foreach (var mb in t.GetComponents<MonoBehaviour>())
                {
                    if (mb == null) continue;
                    var ns = mb.GetType().Namespace;
                    if (ns != null && ns.StartsWith("UnityEngine", StringComparison.Ordinal)) continue;
                    if (ns != null && ns.StartsWith("GambleMenu", StringComparison.Ordinal)) continue;
                    return t.gameObject;
                }
                t = t.parent;
            }
            return null;
        }

        private static void CollectFields(TrackedMachine machine)
        {
            foreach (var mb in machine.Root.GetComponents<MonoBehaviour>())
            {
                if (mb == null) continue;
                var type = mb.GetType();
                var ns = type.Namespace;
                if (ns != null && (ns.StartsWith("UnityEngine", StringComparison.Ordinal) ||
                                   ns.StartsWith("GambleMenu", StringComparison.Ordinal))) continue;

                foreach (var field in type.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance))
                {
                    if (machine.Fields.Count >= MaxFieldsPerMachine) return;
                    if (!Readable(field.FieldType)) continue;
                    machine.Fields.Add(new TrackedField { Owner = mb, Field = field });
                }
            }
        }

        /// <summary>Only values that can be shown as a short string and compared for change.</summary>
        private static bool Readable(Type t) =>
            t.IsPrimitive || t.IsEnum || t == typeof(string) || t == typeof(decimal);

        // --- sampling ---------------------------------------------------------------

        private void Sample(float now)
        {
            foreach (var machine in _machines)
            {
                if (!machine.Alive) continue;

                foreach (var f in machine.Fields)
                {
                    if (f.Owner == null) continue;

                    object raw;
                    try { raw = f.Field.GetValue(f.Owner); }
                    catch { continue; }

                    string text = raw?.ToString() ?? "null";
                    f.Samples++;

                    if (f.Text != null && text != f.Text)
                    {
                        f.Changes++;
                        f.LastChange = now;
                        machine.LastChange = now;
                    }
                    f.Text = text;
                    f.Numeric = double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out double n)
                        ? n : (double?)null;
                }
            }
        }

        // --- signal -----------------------------------------------------------------

        private bool SignalHolds(TrackedMachine machine, float now)
        {
            string needle = _signalField.Value?.Trim();
            if (string.IsNullOrEmpty(needle)) return false;

            var field = machine.Fields.FirstOrDefault(
                f => f.Label.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0);
            if (field == null) return false;

            if (_signalTest.Index == 3) return now - field.LastChange < 1.2f;   // "changes"

            string wanted = _signalValue.Value?.Trim() ?? "";
            if (field.Numeric.HasValue &&
                double.TryParse(wanted, NumberStyles.Float, CultureInfo.InvariantCulture, out double target))
            {
                switch (_signalTest.Index)
                {
                    case 0: return field.Numeric.Value >= target;
                    case 1: return field.Numeric.Value <= target;
                    default: return Math.Abs(field.Numeric.Value - target) < 0.0001;
                }
            }
            return string.Equals(field.Text, wanted, StringComparison.OrdinalIgnoreCase);
        }

        // --- drawing ----------------------------------------------------------------

        protected override void OnDrawOverlay()
        {
            var cam = Camera.main;
            if (cam == null) return;
            float now = Time.unscaledTime;

            GameObject aimed = null;
            if (_aimedOnly.Value &&
                Physics.Raycast(cam.transform.position, cam.transform.forward, out RaycastHit hit, _radius.Value))
                aimed = hit.collider != null ? FindScriptedRoot(hit.collider.gameObject) : null;

            int drawn = 0;
            foreach (var machine in _machines.OrderBy(m => Vector3.Distance(cam.transform.position, m.Root.transform.position)))
            {
                if (!machine.Alive) continue;
                if (_aimedOnly.Value && machine.Root != aimed) continue;
                if (!Hud.ScreenBounds(cam, machine.Bounds(), out Rect box)) continue;
                if (box.width < 8f || box.height < 8f) continue;
                if (++drawn > MaxMachines) break;

                bool signal = SignalHolds(machine, now);
                bool active = now - machine.LastChange < 2.5f;
                Color colour = signal ? _signalColour.Value : active ? _activeColour.Value : _idleColour.Value;

                if (_outline.Value) Hud.OutlineBox(box, colour, signal ? 2.5f : active ? 2f : 1f);

                if (_rows.Value > 0)
                {
                    var rows = machine.Fields
                                      .Where(f => f.Changes > 0)
                                      .OrderByDescending(f => f.Score(now))
                                      .Take(_rows.Value)
                                      .Select(f => $"{f.Label}   {Shorten(f.Text)}")
                                      .ToArray();

                    if (rows.Length == 0) rows = new[] { "nothing has moved yet" };
                    Hud.Plate(box, machine.Root.name, rows, colour, signal || active);
                }

                if (signal)
                {
                    // A slow pulse, so the callout reads as live rather than as a static decal.
                    float pulse = 0.5f + 0.5f * Mathf.Sin(now * 6f);
                    Hud.Callout(box, string.IsNullOrEmpty(_signalText.Value) ? "NOW" : _signalText.Value,
                                _signalColour.Value, pulse);
                }
            }

            if (_machines.Count == 0)
                Hud.Line("machines   none nearby — walk up to one");
        }

        private static string Shorten(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            // Long floats are noise at a glance; three decimals is plenty to see a change.
            if (double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out double d) && s.Length > 8)
                return d.ToString("0.###", CultureInfo.InvariantCulture);
            return s.Length > 22 ? s.Substring(0, 21) + "…" : s;
        }
    }
}
