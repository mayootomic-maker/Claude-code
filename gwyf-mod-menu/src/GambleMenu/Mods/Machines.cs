using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using GambleMenu.Core;
using GambleMenu.UI;
using UnityEngine;

namespace GambleMenu.Mods
{
    /// <summary>
    /// Reads the live state of whatever machine you are looking at.
    ///
    /// This is the answer to "how do I know what to press" that does not require knowing a
    /// single class name in advance: raycast from the camera, take whatever component the hit
    /// object carries, and read its fields. Machines keep their multiplier, their pending
    /// result and their payout table in ordinary fields, so aiming at one and listing them is
    /// the whole trick.
    ///
    /// Whether it shows you an outcome *before* it happens depends on the machine. Where the
    /// game rolls the result up front and then plays an animation, the answer is sitting in a
    /// field and this will show it. Where the result is decided at the end of the animation,
    /// there is nothing to read early and no mod can invent it — the readout will show the
    /// state changing as it resolves instead.
    /// </summary>
    internal sealed class MachineReader : Mod
    {
        public override string Id => "machines.reader";
        public override string Name => "Machine reader";
        public override string Description => "Aim at a machine to see its live values — multiplier, result, payout, odds.";
        public override Category Cat => Category.Machines;
        public override string[] Tags => new[] { "machine", "slot", "automat", "read", "peek", "odds", "outcome", "result", "predict", "what to press" };

        /// <summary>
        /// Field names worth surfacing first.
        ///
        /// Ordered by how directly each tends to answer "what happens if I press now" — a
        /// field called "result" is worth more than one called "value", so the list is scanned
        /// in order and the readout keeps that order.
        /// </summary>
        private static readonly string[] Interesting =
        {
            "result", "outcome", "win", "won", "jackpot", "prize", "payout", "reward",
            "multiplier", "multi", "crash", "target", "roll", "rolled", "next",
            "odds", "chance", "probability", "weight", "rtp",
            "bet", "stake", "value", "amount", "spin", "state", "index", "symbol"
        };

        private FloatOption _range;
        private BoolOption _allFields;
        private BoolOption _showComponent;
        private IntOption _maxLines;
        private KeyOption _pinKey;
        private ColorOption _colour;

        private GameObject _pinned;
        private GameObject _current;
        private readonly List<string> _lines = new List<string>();
        private float _nextRead;

        protected override void Build()
        {
            _range = Opt(new FloatOption("machines.reader.range", "Reach", 6f, 1f, 40f,
                "How far ahead to look for a machine.") { Step = 0.5f, Format = "0.#", Unit = "m" });
            _allFields = Opt(new BoolOption("machines.reader.all", "Show every field", false,
                "Off shows only fields whose names look like a result, odds or payout. On shows everything the component has."));
            _showComponent = Opt(new BoolOption("machines.reader.type", "Show component names", true,
                "Useful for the Developer tab — this is the class name to type into the live field editor."));
            _maxLines = Opt(new IntOption("machines.reader.lines", "Most lines", 14, 4, 40));
            _pinKey = Opt(new KeyOption("machines.reader.pin", "Pin/unpin target", KeyCode.P,
                "Locks the readout to the machine you are aiming at, so you can look away and still watch it."));
            _colour = Opt(new ColorOption("machines.reader.colour", "Marker colour", new Color(0.91f, 0.71f, 0.30f, 1f)));
        }

        protected override void OnEnable()
        {
            _pinned = null;
            _lines.Clear();
            _nextRead = 0f;
        }

        protected override void OnUpdate()
        {
            if (InputBridge.GetKeyDown(_pinKey.Value))
            {
                if (_pinned != null) { _pinned = null; Notifier.Info("Machine reader unpinned."); }
                else if (_current != null) { _pinned = _current; Notifier.Success($"Pinned to {_current.name}."); }
                else Notifier.Warn("Aim at a machine first, then press the pin key.");
            }

            // Ten reads a second is far more than the eye needs and keeps the reflection cost
            // off the frame budget.
            if (Time.unscaledTime < _nextRead) return;
            _nextRead = Time.unscaledTime + 0.1f;

            var target = _pinned != null ? _pinned : Aimed();
            _current = _pinned != null ? _pinned : target;
            Collect(target);
        }

        private GameObject Aimed()
        {
            var cam = Camera.main;
            if (cam == null) return null;
            return Physics.Raycast(cam.transform.position, cam.transform.forward, out RaycastHit hit, _range.Value)
                ? hit.collider != null ? hit.collider.gameObject : null
                : null;
        }

        private void Collect(GameObject target)
        {
            _lines.Clear();
            if (target == null) return;

            // Machines are usually a hierarchy: the collider sits on a child while the logic
            // lives on a parent, so search upward as well as on the hit object itself.
            var components = new List<MonoBehaviour>();
            components.AddRange(target.GetComponents<MonoBehaviour>());
            var parent = target.transform.parent;
            int hops = 0;
            while (parent != null && hops++ < 3)
            {
                components.AddRange(parent.GetComponents<MonoBehaviour>());
                parent = parent.parent;
            }

            foreach (var component in components)
            {
                if (component == null) continue;
                var type = component.GetType();
                // Unity's own components carry nothing worth reading here.
                if (type.Namespace != null && type.Namespace.StartsWith("UnityEngine", StringComparison.Ordinal)) continue;

                var fields = type.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                var picked = _allFields.Value ? fields.AsEnumerable() : fields.Where(IsInteresting).OrderBy(Rank);
                bool headerWritten = false;

                foreach (var field in picked)
                {
                    if (_lines.Count >= _maxLines.Value) return;
                    if (!Readable(field.FieldType)) continue;

                    object value;
                    try { value = field.GetValue(component); }
                    catch { continue; }

                    if (!headerWritten && _showComponent.Value)
                    {
                        _lines.Add($"— {type.Name} —");
                        headerWritten = true;
                    }
                    _lines.Add($"{field.Name}  =  {Reflect.Describe(value)}");
                }
            }

            if (_lines.Count == 0)
                _lines.Add(_allFields.Value
                    ? $"{target.name}: no readable fields"
                    : $"{target.name}: nothing result-shaped — try 'Show every field'");
        }

        private static bool IsInteresting(FieldInfo f)
        {
            string n = f.Name.ToLowerInvariant();
            foreach (var word in Interesting) if (n.Contains(word)) return true;
            return false;
        }

        private static int Rank(FieldInfo f)
        {
            string n = f.Name.ToLowerInvariant();
            for (int i = 0; i < Interesting.Length; i++) if (n.Contains(Interesting[i])) return i;
            return Interesting.Length;
        }

        /// <summary>Only value types worth putting on a HUD line; an object reference tells the
        /// player nothing about what to press.</summary>
        private static bool Readable(Type t) =>
            t.IsPrimitive || t.IsEnum || t == typeof(string) || t == typeof(decimal) ||
            t == typeof(Vector2) || t == typeof(Vector3);

        protected override void OnDrawOverlay()
        {
            var target = _pinned != null ? _pinned : _current;
            if (target == null)
            {
                Hud.Line("machine   aim at one");
                return;
            }

            Hud.Line(_pinned != null ? $"machine   {target.name}  [pinned]" : $"machine   {target.name}");
            foreach (var line in _lines) Hud.Line("  " + line);

            var cam = Camera.main;
            if (cam != null && Hud.Project(cam, target.transform.position, out Vector2 screen))
                Hud.Marker(screen, _pinned != null ? "pinned" : "reading", _colour.Value, 0f);
        }
    }

    /// <summary>
    /// Watches one machine field and announces the moment it changes.
    ///
    /// Reading a value is only half of "know what to press": the useful signal is often the
    /// change — a result field populating a beat before the animation admits it. This latches
    /// onto whatever the reader is pointed at and reports transitions rather than levels.
    /// </summary>
    internal sealed class OutcomeWatch : Mod
    {
        public override string Id => "machines.watch";
        public override string Name => "Outcome watch";
        public override string Description => "Announces the instant a machine's chosen field changes value.";
        public override Category Cat => Category.Machines;
        public override string[] Tags => new[] { "outcome", "predict", "change", "watch", "alert", "result" };

        private StringOption _fieldName;
        private FloatOption _range;
        private BoolOption _toast;
        private BoolOption _onlyIncrease;

        private string _lastValue;
        private string _lastOwner;
        private float _nextRead;

        protected override void Build()
        {
            _fieldName = Opt(new StringOption("machines.watch.field", "Field name contains", "result",
                "Matched loosely against the aimed machine's field names.") { Placeholder = "result" });
            _range = Opt(new FloatOption("machines.watch.range", "Reach", 6f, 1f, 40f) { Step = 0.5f, Format = "0.#", Unit = "m" });
            _toast = Opt(new BoolOption("machines.watch.toast", "Pop a notification on change", true));
            _onlyIncrease = Opt(new BoolOption("machines.watch.up", "Only when it goes up", false,
                "For multipliers that climb — tells you it moved in your favour."));
        }

        protected override void OnEnable()
        {
            _lastValue = null;
            _lastOwner = null;
        }

        protected override void OnUpdate()
        {
            if (Time.unscaledTime < _nextRead) return;
            _nextRead = Time.unscaledTime + 0.05f;

            var cam = Camera.main;
            if (cam == null) return;
            if (!Physics.Raycast(cam.transform.position, cam.transform.forward, out RaycastHit hit, _range.Value)) return;
            if (hit.collider == null) return;

            string needle = _fieldName.Value?.Trim();
            if (string.IsNullOrEmpty(needle)) return;

            var go = hit.collider.gameObject;
            foreach (var component in go.GetComponentsInParent<MonoBehaviour>())
            {
                if (component == null) continue;
                var type = component.GetType();
                if (type.Namespace != null && type.Namespace.StartsWith("UnityEngine", StringComparison.Ordinal)) continue;

                foreach (var field in type.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance))
                {
                    if (field.Name.IndexOf(needle, StringComparison.OrdinalIgnoreCase) < 0) continue;

                    object raw;
                    try { raw = field.GetValue(component); } catch { continue; }
                    string text = Reflect.Describe(raw);
                    string owner = $"{type.Name}.{field.Name}";

                    if (owner != _lastOwner) { _lastOwner = owner; _lastValue = text; return; }
                    if (text == _lastValue) return;

                    bool rose = Rose(_lastValue, text);
                    string previous = _lastValue;
                    _lastValue = text;

                    if (_onlyIncrease.Value && !rose) return;
                    if (_toast.Value) Notifier.Success($"{field.Name}: {previous} → {text}");
                    return;
                }
            }
        }

        private static bool Rose(string before, string after)
        {
            return double.TryParse(before, System.Globalization.NumberStyles.Float,
                                   System.Globalization.CultureInfo.InvariantCulture, out double a) &&
                   double.TryParse(after, System.Globalization.NumberStyles.Float,
                                   System.Globalization.CultureInfo.InvariantCulture, out double b) && b > a;
        }

        protected override void OnDrawOverlay()
        {
            if (_lastOwner == null) { Hud.Line("watch     aim at a machine"); return; }
            Hud.Line($"watch     {_lastOwner} = {_lastValue}");
        }
    }
}
