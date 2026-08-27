using System;
using System.Collections;
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
    /// <summary>A place on a machine that some field is currently pointing at.</summary>
    internal sealed class OutcomeTarget
    {
        public string Key;          // stable identity: Type.field, or Type.list[index]
        public Transform Where;
        public float Marked;        // when this target was last selected
        public int Wins;
        public int Losses;

        public int Total => Wins + Losses;

        /// <summary>
        /// What this pointer has meant so far, from -1 (always preceded a loss) to +1.
        ///
        /// Nothing tells a mod which field means "winner" and which means "the one that busts
        /// you", so this does not guess — it watches what happened afterwards and reports the
        /// record. Two spins prove nothing; a dozen usually settle it.
        /// </summary>
        public float Bias => Total == 0 ? 0f : (Wins - Losses) / (float)Total;

        public string Tally => Total == 0 ? "no data yet" : $"{Wins}W / {Losses}L";
    }

    /// <summary>
    /// Marks the spot on a machine that its own state is pointing at.
    ///
    /// Every previous attempt at this read numbers and printed them, which answers "what is the
    /// multiplier" but never "which one of these is the bad one". The thing that answers that is
    /// not a number at all: a machine that has already chosen an outcome usually holds a
    /// reference to the object it chose — a slot, a segment, a card — or an index into a list of
    /// them. That reference is a position in the world, so it can simply be drawn on.
    ///
    /// Which of those pointers means good and which means ruin is not knowable in advance, so
    /// this learns it: each marker's appearance is matched against what the balance did next,
    /// and the marker is coloured by its own record. Green has preceded gains, red has preceded
    /// losses, grey has not been seen enough times to say.
    /// </summary>
    internal sealed class OutcomeMapper : Mod
    {
        public override string Id => "machines.outcome";
        public override string Name => "Outcome mapper";
        public override string Description => "Marks the exact slot, segment or card a machine is pointing at — and learns which ones lose.";
        public override Category Cat => Category.Machines;
        public override string[] Tags => new[] { "outcome", "predict", "mark", "losing", "winning", "segment", "slot", "where", "target", "wheel" };

        private const int MaxMachines = 8;
        private const int MaxPointersPerMachine = 12;

        private FloatOption _radius;
        private FloatOption _settleWindow;
        private IntOption _confidence;
        private BoolOption _onlyChanged;
        private BoolOption _showTally;
        private EnumOption _style;
        private FloatOption _ringSize;
        private ColorOption _goodColour, _badColour, _unknownColour;
        private StringOption _outcomeField;

        private readonly List<GameObject> _machines = new List<GameObject>();
        private readonly Dictionary<string, OutcomeTarget> _targets = new Dictionary<string, OutcomeTarget>(StringComparer.Ordinal);
        private readonly List<OutcomeTarget> _live = new List<OutcomeTarget>();

        private float _nextScan, _nextSample;
        private double? _lastOutcomeValue;
        private readonly List<OutcomeTarget> _awaitingOutcome = new List<OutcomeTarget>();
        private float _awaitingSince;

        protected override void Build()
        {
            _radius = Opt(new FloatOption("machines.outcome.radius", "Search radius", 14f, 2f, 60f)
            { Step = 1f, Format = "0", Unit = "m" });
            _onlyChanged = Opt(new BoolOption("machines.outcome.changed", "Only after it changes", true,
                "On marks a spot only once the machine has just chosen it, which is the moment that matters. Off marks whatever it currently points at."));
            _settleWindow = Opt(new FloatOption("machines.outcome.window", "Judge the result within", 6f, 1f, 30f,
                "How long after a spot is marked to watch for the balance moving.") { Step = 0.5f, Format = "0.#", Unit = "s" });
            _confidence = Opt(new IntOption("machines.outcome.confidence", "Rounds before colouring", 3, 1, 20,
                "How many observations before a marker is called good or bad. Lower reacts faster and is wrong more often."));
            _showTally = Opt(new BoolOption("machines.outcome.tally", "Show the record on the nearest one", true,
                "Only the closest marker is captioned. Every marker labelled at once is how an overlay turns into a wall of text."));
            _style = Opt(new EnumOption("machines.outcome.style", "Marker style",
                new[] { "Ring and pin", "Box" }, 0,
                "A ring is drawn on the floor in perspective and reads as part of the room. A box is drawn around the object in screen space, which is the look of a wallhack."));
            _ringSize = Opt(new FloatOption("machines.outcome.ring", "Ring size", 1.15f, 0.4f, 3f,
                "Multiplies the object's own footprint.") { Step = 0.05f, Format = "0.00", Unit = "×",
                VisibleWhen = () => _style.Index == 0 });

            _goodColour = Opt(new ColorOption("machines.outcome.good", "Has preceded gains", new Color(0.36f, 0.85f, 0.55f, 1f)));
            _badColour = Opt(new ColorOption("machines.outcome.bad", "Has preceded losses", new Color(0.94f, 0.38f, 0.43f, 1f)));
            _unknownColour = Opt(new ColorOption("machines.outcome.unknown", "Not enough data", new Color(0.85f, 0.70f, 0.32f, 1f)));

            _outcomeField = Opt(new StringOption("machines.outcome.source", "Outcome comes from", "",
                "Blank uses this game's money, when the menu can find it. Otherwise name a field as Class.field — the value that goes up when you win.")
            { Placeholder = "(the bank balance)" });

            Act("Forget what it has learned", () =>
            {
                foreach (var t in _targets.Values) { t.Wins = 0; t.Losses = 0; }
                Notifier.Info("Every marker's record has been cleared.");
            });
        }

        protected override void OnEnable()
        {
            _machines.Clear();
            _live.Clear();
            _awaitingOutcome.Clear();
            _nextScan = 0f;
            _nextSample = 0f;
            _lastOutcomeValue = ReadOutcome();

            if (!_lastOutcomeValue.HasValue)
                Notifier.Warn("No outcome value found, so markers will show positions but never learn which lose. Name one under \"Outcome comes from\".");
        }

        // --- the value that says whether a round went well --------------------------

        private double? ReadOutcome()
        {
            string custom = _outcomeField.Value?.Trim();
            if (string.IsNullOrEmpty(custom))
            {
                long? money = RunState.Money;
                return money.HasValue ? money.Value : (double?)null;
            }

            int dot = custom.LastIndexOf('.');
            if (dot <= 0) return null;

            var type = HarmonyLib.AccessTools.TypeByName(custom.Substring(0, dot));
            if (type == null) return null;
            var field = HarmonyLib.AccessTools.Field(type, custom.Substring(dot + 1));
            if (field == null) return null;

            try
            {
                object owner = field.IsStatic ? null : (object)Object.FindObjectOfType(type);
                if (!field.IsStatic && owner == null) return null;
                object raw = field.GetValue(owner);
                return raw == null ? (double?)null : Convert.ToDouble(raw, CultureInfo.InvariantCulture);
            }
            catch { return null; }
        }

        // --- discovery --------------------------------------------------------------

        protected override void OnUpdate()
        {
            float now = Time.unscaledTime;
            if (now >= _nextScan) { _nextScan = now + 2f; ScanMachines(); }
            if (now >= _nextSample) { _nextSample = now + 0.1f; SamplePointers(now); }
            JudgeOutcome(now);
        }

        private void ScanMachines()
        {
            var origin = GameBridge.LocalPlayer()?.transform.position ?? Camera.main?.transform.position;
            if (!origin.HasValue) return;

            _machines.RemoveAll(m => m == null ||
                                     Vector3.Distance(m.transform.position, origin.Value) > _radius.Value * 1.4f);

            Collider[] hits;
            try { hits = Physics.OverlapSphere(origin.Value, _radius.Value); }
            catch { return; }

            foreach (var hit in hits)
            {
                if (_machines.Count >= MaxMachines) break;
                if (hit == null) continue;
                var root = ScriptedRoot(hit.gameObject);
                if (root != null && !_machines.Contains(root)) _machines.Add(root);
            }
        }

        private static GameObject ScriptedRoot(GameObject from)
        {
            var t = from.transform;
            int hops = 0;
            while (t != null && hops++ < 4)
            {
                foreach (var mb in t.GetComponents<MonoBehaviour>())
                {
                    if (mb == null) continue;
                    var ns = mb.GetType().Namespace;
                    if (ns != null && (ns.StartsWith("UnityEngine", StringComparison.Ordinal) ||
                                       ns.StartsWith("GambleMenu", StringComparison.Ordinal))) continue;
                    return t.gameObject;
                }
                t = t.parent;
            }
            return null;
        }

        /// <summary>Turns whatever a field holds into a place in the world, or null.</summary>
        private static Transform AsPlace(object value)
        {
            switch (value)
            {
                case null: return null;
                case Transform t: return t;
                case GameObject go: return go == null ? null : go.transform;
                case Component c: return c == null ? null : c.transform;
                default: return null;
            }
        }

        // --- pointer sampling -------------------------------------------------------

        /// <summary>
        /// Finds every place each machine is currently pointing at.
        ///
        /// Two shapes cover almost every casino machine ever written: a field holding the
        /// chosen object outright, and a list of candidates paired with an index into it. The
        /// second is why this looks at integers as well — on its own an index means nothing,
        /// but against a list of segments it is a position.
        /// </summary>
        private void SamplePointers(float now)
        {
            _live.Clear();

            foreach (var machine in _machines)
            {
                if (machine == null) continue;

                foreach (var mb in machine.GetComponents<MonoBehaviour>())
                {
                    if (mb == null) continue;
                    var type = mb.GetType();
                    var ns = type.Namespace;
                    if (ns != null && (ns.StartsWith("UnityEngine", StringComparison.Ordinal) ||
                                       ns.StartsWith("GambleMenu", StringComparison.Ordinal))) continue;

                    var fields = type.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                    var lists = new List<(string name, IList list)>();
                    var indices = new List<(string name, int value)>();
                    int added = 0;

                    foreach (var field in fields)
                    {
                        if (added >= MaxPointersPerMachine) break;

                        object raw;
                        try { raw = field.GetValue(mb); } catch { continue; }
                        if (raw == null) continue;

                        // 1. A direct reference to the chosen thing.
                        var place = AsPlace(raw);
                        if (place != null)
                        {
                            Register($"{type.Name}.{field.Name}", place, now);
                            added++;
                            continue;
                        }

                        // 2. Collect the halves of the list+index pattern for the pass below.
                        if (raw is IList list && list.Count > 0 && list.Count < 256 && AsPlace(list[0]) != null)
                            lists.Add((field.Name, list));
                        else if (field.FieldType == typeof(int))
                            indices.Add((field.Name, (int)raw));
                    }

                    foreach (var (listName, list) in lists)
                    {
                        foreach (var (indexName, index) in indices)
                        {
                            if (index < 0 || index >= list.Count) continue;
                            var place = AsPlace(list[index]);
                            if (place == null) continue;
                            Register($"{type.Name}.{listName}[{indexName}]", place, now);
                        }
                    }
                }
            }
        }

        private void Register(string key, Transform place, float now)
        {
            if (!_targets.TryGetValue(key, out var target))
            {
                target = new OutcomeTarget { Key = key, Where = place, Marked = now };
                _targets[key] = target;
                // A pointer's first value is where it happened to be sitting, not a decision.
                _live.Add(target);
                return;
            }

            if (target.Where != place)
            {
                target.Where = place;
                target.Marked = now;

                // The machine just chose somewhere new — that is the event worth judging.
                if (!_awaitingOutcome.Contains(target))
                {
                    _awaitingOutcome.Add(target);
                    _awaitingSince = now;
                    _lastOutcomeValue = ReadOutcome();
                }
            }
            _live.Add(target);
        }

        // --- learning ---------------------------------------------------------------

        private void JudgeOutcome(float now)
        {
            if (_awaitingOutcome.Count == 0) return;

            double? current = ReadOutcome();
            if (!current.HasValue || !_lastOutcomeValue.HasValue)
            {
                if (now - _awaitingSince > _settleWindow.Value) _awaitingOutcome.Clear();
                return;
            }

            double delta = current.Value - _lastOutcomeValue.Value;

            if (Math.Abs(delta) > 0.0001)
            {
                foreach (var target in _awaitingOutcome)
                {
                    if (delta > 0) target.Wins++;
                    else target.Losses++;
                }
                _awaitingOutcome.Clear();
                _lastOutcomeValue = current;
                return;
            }

            // Nothing happened in the window; the round was not decided by these markers.
            if (now - _awaitingSince > _settleWindow.Value)
            {
                _awaitingOutcome.Clear();
                _lastOutcomeValue = current;
            }
        }

        // --- drawing ----------------------------------------------------------------

        private Color ColourFor(OutcomeTarget t)
        {
            if (t.Total < _confidence.Value) return _unknownColour.Value;
            if (t.Bias > 0.2f) return _goodColour.Value;
            if (t.Bias < -0.2f) return _badColour.Value;
            return _unknownColour.Value;
        }

        private string VerdictFor(OutcomeTarget t)
        {
            if (t.Total < _confidence.Value) return "?";
            if (t.Bias > 0.2f) return "WIN";
            if (t.Bias < -0.2f) return "LOSE";
            return "MIXED";
        }

        /// <summary>
        /// True while a marker whose record shows gains has just been chosen.
        ///
        /// Exposed so automation can act on this mod's own verdict rather than deriving a
        /// second one; two systems deciding separately what counts as a win would disagree the
        /// moment either was tuned, and the one holding the evidence should be the one to say.
        /// </summary>
        public bool FreshWinMarked
        {
            get
            {
                float now = Time.unscaledTime;
                foreach (var t in _live)
                {
                    if (t.Where == null) continue;
                    if (now - t.Marked > 1.5f) continue;
                    if (t.Total >= _confidence.Value && t.Bias > 0.2f) return true;
                }
                return false;
            }
        }

        protected override void OnDrawOverlay()
        {
            var cam = Camera.main;
            if (cam == null) return;
            float now = Time.unscaledTime;
            var eye = cam.transform.position;

            // The nearest marker is the only one captioned. Labelling all of them is what made
            // the last version read as a debug overlay rather than something designed.
            OutcomeTarget nearest = null;
            float nearestDistance = float.MaxValue;

            var visible = new List<(OutcomeTarget target, Bounds bounds, float distance)>();

            foreach (var target in _live)
            {
                if (target.Where == null) continue;
                if (_onlyChanged.Value && now - target.Marked > _settleWindow.Value) continue;

                var bounds = BoundsOf(target.Where);
                float distance = Vector3.Distance(eye, bounds.center);
                if (distance > _radius.Value * 1.5f) continue;

                visible.Add((target, bounds, distance));
                if (distance < nearestDistance) { nearestDistance = distance; nearest = target; }
                if (visible.Count >= 24) break;
            }

            foreach (var (target, bounds, distance) in visible)
            {
                Color colour = ColourFor(target);
                bool fresh = now - target.Marked < 1.5f;

                // Distant markers fade rather than piling up at full strength.
                float fade = Mathf.Lerp(1f, 0.3f, Mathf.Clamp01(distance / Mathf.Max(1f, _radius.Value)));
                float previousAlpha = Draw.Alpha;
                Draw.Alpha = previousAlpha * fade;

                if (_style.Index == 1)
                {
                    if (Hud.ScreenBounds(cam, bounds, out Rect box) && box.width > 4f)
                        Hud.OutlineBox(box, colour, fresh ? 2.5f : 1.5f);
                }
                else
                {
                    float radius = Mathf.Max(bounds.extents.x, bounds.extents.z) * _ringSize.Value;
                    if (radius < 0.05f) radius = 0.25f;

                    var floor = new Vector3(bounds.center.x, bounds.min.y + 0.02f, bounds.center.z);
                    Hud.GroundRing(cam, floor, radius, colour, fresh ? 2.6f : 1.6f);

                    // A second, tighter ring gives a freshly chosen spot a pulse without
                    // resorting to a flashing colour.
                    if (fresh)
                    {
                        float pulse = 0.55f + 0.45f * Mathf.Sin(now * 6f);
                        Hud.GroundRing(cam, floor, radius * (0.55f + 0.3f * pulse),
                                       Theme.Fade(colour, 0.5f * pulse), 1.4f, 28);
                    }
                }

                var top = new Vector3(bounds.center.x, bounds.max.y + 0.06f, bounds.center.z);
                if (Hud.Project(cam, top, out Vector2 tip))
                {
                    float scale = Mathf.Lerp(1.05f, 0.62f, Mathf.Clamp01(distance / Mathf.Max(1f, _radius.Value)));
                    Hud.Pin(tip, GlyphFor(target), colour, scale);

                    if (_showTally.Value && target == nearest)
                        Hud.PinCaption(new Vector2(tip.x, tip.y + 4f),
                                       $"{VerdictFor(target)}  ·  {target.Tally}", colour, 1f);
                }

                Draw.Alpha = previousAlpha;
            }

            if (_live.Count == 0)
                Hud.Line("outcome   nothing is pointing anywhere yet — play a round");
            else if (!_lastOutcomeValue.HasValue)
                Hud.Line("outcome   marking positions, but no win/lose value to learn from");
        }

        private char GlyphFor(OutcomeTarget t)
        {
            if (t.Total < _confidence.Value) return '?';
            if (t.Bias > 0.2f) return 'w';
            if (t.Bias < -0.2f) return 'l';
            return '?';
        }

        private static Bounds BoundsOf(Transform t)
        {
            var renderers = t.GetComponentsInChildren<Renderer>(false);
            if (renderers.Length == 0) return new Bounds(t.position, Vector3.one * 0.3f);

            var b = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++) b.Encapsulate(renderers[i].bounds);
            return b;
        }
    }
}
