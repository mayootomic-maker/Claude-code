using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using GambleMenu.Core;
using GambleMenu.UI;
using HarmonyLib;
using UnityEngine;
using Object = UnityEngine.Object;

namespace GambleMenu.Mods
{
    /// <summary>What one machine has paid out, since this mod was switched on.</summary>
    internal sealed class TableRecord
    {
        public int Rounds;
        public int Payouts;
        public double Net;
        public float LastPayout;

        public float HitRate => Rounds == 0 ? 0f : Payouts / (float)Rounds;
    }

    /// <summary>
    /// Reads the machine you are looking at, and marks the thing to press.
    ///
    /// This replaces two earlier mods that swept every collider in range, reflected over every
    /// field of every component on them, and drew a marker for each — which produced a screen
    /// full of boxes and a frame-rate cost to match, while answering nothing in particular.
    ///
    /// Both problems had the same cause: not knowing what a machine *was*, so everything nearby
    /// had to be treated as one. It is <c>GameBase</c>. Every casino game in this game derives
    /// from it and it carries the name, the type, whether a round is running, the method a press
    /// calls, and the payout itself. Those names were read out of the reference tables of five
    /// shipped mods compiled against the real assembly, not guessed from the outside.
    ///
    /// So this looks at one machine — the one under your crosshair — asks it directly, and
    /// hooks <c>Payout</c> to learn what actually happened rather than inferring it from the
    /// bank balance moving.
    /// </summary>
    internal sealed class TableRead : Mod
    {
        public override string Id => "machines.tableread";
        public override string Name => "Table read";
        public override string Description => "Look at a machine: what it is, whether it is running, where to press, and what it has paid.";
        public override Category Cat => Category.Machines;
        public override string[] Tags => new[] { "machine", "read", "press", "bet", "hit", "predict", "outcome", "slots", "crash", "table" };
        public override Binding[] Requires => new Binding[] { GameBridge.TGameBase };

        private FloatOption _reach;
        private BoolOption _markPress;
        private BoolOption _showRecord;
        private BoolOption _nearestFallback;
        private ColorOption _idleColour, _liveColour, _pressColour;

        // Payout events are recorded by a static patch, so the record survives the aimed
        // machine changing and is keyed by instance rather than by whatever is in view.
        private static readonly Dictionary<int, TableRecord> Records = new Dictionary<int, TableRecord>();
        private static bool _hooked;

        private Component _aimed;
        private Transform _pressTarget;
        private string _pressPrompt;
        private string _title = "";
        private string _subtitle = "";
        private Bounds _bounds;
        private float _nextPoll;
        private bool _wasPlaying;

        protected override void Build()
        {
            _reach = Opt(new FloatOption("machines.tableread.reach", "Look distance", 5f, 1f, 25f,
                "How far ahead a machine counts as the one you are looking at.")
            { Step = 0.5f, Format = "0.#", Unit = "m" });
            _nearestFallback = Opt(new BoolOption("machines.tableread.nearest", "Fall back to the nearest", true,
                "When you are not aiming at anything, read the closest machine instead."));
            _markPress = Opt(new BoolOption("machines.tableread.press", "Mark where to press", true,
                "Rings the button this machine is actually interacted through, with its own prompt."));
            _showRecord = Opt(new BoolOption("machines.tableread.record", "Show what it has paid", true,
                "Rounds played and how many paid out, counted from the game's own payout call."));

            _idleColour = Opt(new ColorOption("machines.tableread.idle", "Ready", new Color(0.91f, 0.71f, 0.30f, 1f)));
            _liveColour = Opt(new ColorOption("machines.tableread.live", "Round running", new Color(0.44f, 0.72f, 0.95f, 1f)));
            _pressColour = Opt(new ColorOption("machines.tableread.press2", "Press here", new Color(0.36f, 0.85f, 0.55f, 1f)));

            Act("Forget the payout record", () =>
            {
                Records.Clear();
                Notifier.Info("Payout records cleared.");
            });
        }

        // --- the payout hook --------------------------------------------------------

        /// <summary>
        /// Records a payout at the moment the game makes one.
        ///
        /// This is the difference between knowing and inferring. Watching the bank balance
        /// cannot tell a payout from a purchase, another player's win, or a refund; the game
        /// calling Payout on a specific machine can only mean one thing.
        /// </summary>
        private static void PayoutPostfix(object __instance, object[] __args)
        {
            if (!(__instance is Component c) || c == null) return;

            int id = c.GetInstanceID();
            if (!Records.TryGetValue(id, out var record)) Records[id] = record = new TableRecord();

            record.Payouts++;

            // The amount type is the game's own BigNumber in at least some overloads, so take a
            // number when one is offered and count the event either way.
            if (__args != null)
            {
                foreach (var arg in __args)
                {
                    if (arg == null) continue;
                    try
                    {
                        if (!(arg is IConvertible)) continue;
                        double v = Convert.ToDouble(arg, CultureInfo.InvariantCulture);
                        record.Net += v;
                        record.LastPayout = (float)v;
                        break;
                    }
                    catch { /* not a number; the event still counts */ }
                }
            }
        }

        protected override IEnumerable<PatchSpec> Patches()
        {
            yield return PatchSpec.Of(GameBridge.GbPayout,
                                      postfix: AccessTools.Method(typeof(TableRead), nameof(PayoutPostfix)));
        }

        protected override void OnEnable()
        {
            _aimed = null;
            _nextPoll = 0f;
            _hooked = GameBridge.GbPayout.Ok;

            if (!_hooked)
                Notifier.Warn("This build does not expose GameBase.Payout, so rounds are counted but payouts are not.");
        }

        // --- finding the machine ----------------------------------------------------

        protected override void OnUpdate()
        {
            // Five polls a second is far more than the eye needs, and it is one typed query
            // rather than the whole-scene reflection sweep this used to do every frame.
            if (Time.unscaledTime < _nextPoll) return;
            _nextPoll = Time.unscaledTime + 0.2f;

            var cam = Camera.main;
            if (cam == null) { _aimed = null; return; }

            Component found = Aimed(cam);
            if (found == null && _nearestFallback.Value) found = Nearest(cam);

            if (found != _aimed)
            {
                _aimed = found;
                _pressTarget = null;
                _pressPrompt = null;
                if (_aimed != null) Describe();
            }
            else if (_aimed != null)
            {
                Refresh();
            }
        }

        private Component Aimed(Camera cam)
        {
            if (!Physics.Raycast(cam.transform.position, cam.transform.forward, out RaycastHit hit, _reach.Value))
                return null;
            if (hit.collider == null) return null;
            return hit.collider.GetComponentInParent(GameBridge.TGameBase.Type) as Component;
        }

        private Component Nearest(Camera cam)
        {
            Component best = null;
            float bestDistance = float.MaxValue;
            var eye = cam.transform.position;

            try
            {
                // A typed lookup over one class, not every MonoBehaviour in the scene.
                foreach (var candidate in Object.FindObjectsOfType(GameBridge.TGameBase.Type))
                {
                    if (!(candidate is Component c) || c == null) continue;
                    float d = Vector3.Distance(eye, c.transform.position);
                    if (d > _reach.Value * 3f || d >= bestDistance) continue;
                    bestDistance = d;
                    best = c;
                }
            }
            catch (Exception ex) { Log.Warn($"machine lookup failed: {ex.Message}"); }

            return best;
        }

        /// <summary>Reads the fixed facts once, when the aimed machine changes.</summary>
        private void Describe()
        {
            _title = ReadString(GameBridge.GbGameName) ?? _aimed.gameObject.name;

            object type = GameBridge.GbGameType.Ok ? GameBridge.GbGameType.Get(_aimed) : null;
            _subtitle = type != null ? type.ToString() : "";

            var renderers = _aimed.GetComponentsInChildren<Renderer>(false);
            if (renderers.Length > 0)
            {
                _bounds = renderers[0].bounds;
                for (int i = 1; i < renderers.Length; i++) _bounds.Encapsulate(renderers[i].bounds);
            }
            else
            {
                _bounds = new Bounds(_aimed.transform.position, Vector3.one * 0.6f);
            }

            FindPressTarget();
            Refresh();
        }

        /// <summary>
        /// Locates the thing you actually press on this machine.
        ///
        /// InteractableBase is the game's own interaction component, so the button is not
        /// guessed from geometry or a name filter — it is the object the game itself would
        /// hand a prompt to, and its InteractableName is that prompt.
        /// </summary>
        private void FindPressTarget()
        {
            _pressTarget = null;
            _pressPrompt = null;
            if (!GameBridge.TInteractable.Ok || _aimed == null) return;

            try
            {
                var interactables = _aimed.GetComponentsInChildren(GameBridge.TInteractable.Type, false);
                if (interactables == null || interactables.Length == 0) return;

                var chosen = interactables[0] as Component;
                if (chosen == null) return;

                _pressTarget = chosen.transform;
                if (GameBridge.InteractableName.Ok)
                    _pressPrompt = GameBridge.InteractableName.Invoke(chosen) as string;
            }
            catch (Exception ex) { Log.Warn($"could not find the press target: {ex.Message}"); }
        }

        /// <summary>Re-reads only what changes during a round.</summary>
        private void Refresh()
        {
            if (_aimed == null) return;

            bool playing = GameBridge.GbIsPlaying.Ok && GameBridge.GbIsPlaying.Get(_aimed) is bool b && b;

            // A round ending is the moment to count it; Payout fires only when one pays.
            if (_wasPlaying && !playing)
            {
                int id = _aimed.GetInstanceID();
                if (!Records.TryGetValue(id, out var record)) Records[id] = record = new TableRecord();
                record.Rounds++;
            }
            _wasPlaying = playing;
        }

        private string ReadString(FieldBinding binding)
        {
            if (!binding.Ok || _aimed == null) return null;
            return binding.Get(_aimed) as string;
        }

        // --- drawing ----------------------------------------------------------------

        protected override void OnDrawOverlay()
        {
            var cam = Camera.main;
            if (cam == null) return;

            if (_aimed == null)
            {
                Hud.Line("table     look at a machine");
                return;
            }

            bool playing = GameBridge.GbIsPlaying.Ok && GameBridge.GbIsPlaying.Get(_aimed) is bool b && b;
            Color colour = playing ? _liveColour.Value : _idleColour.Value;

            // One ring, on one machine. Not a marker per candidate object.
            float radius = Mathf.Max(0.3f, Mathf.Max(_bounds.extents.x, _bounds.extents.z) * 1.1f);
            var floor = new Vector3(_bounds.center.x, _bounds.min.y + 0.02f, _bounds.center.z);
            Hud.GroundRing(cam, floor, radius, colour, playing ? 2.4f : 1.8f);

            // The press target gets its own, tighter ring and the game's own prompt.
            if (_markPress.Value && _pressTarget != null && !playing)
            {
                var pressPos = _pressTarget.position;
                Hud.GroundRing(cam, new Vector3(pressPos.x, _bounds.min.y + 0.03f, pressPos.z),
                               radius * 0.42f, _pressColour.Value, 2.2f, 28);

                if (Hud.Project(cam, pressPos, out Vector2 pressAt))
                {
                    Hud.Pin(pressAt, 'w', _pressColour.Value, 0.8f);
                    Hud.PinCaption(new Vector2(pressAt.x, pressAt.y + 4f),
                                   string.IsNullOrEmpty(_pressPrompt) ? "press here" : _pressPrompt,
                                   _pressColour.Value, 1f);
                }
            }

            if (!Hud.Project(cam, new Vector3(_bounds.center.x, _bounds.max.y + 0.1f, _bounds.center.z),
                             out Vector2 top))
                return;

            var rows = new List<string>(3)
            {
                playing ? "round running" : "ready"
            };

            if (!string.IsNullOrEmpty(_subtitle)) rows[0] = $"{_subtitle}  ·  {rows[0]}";

            if (_showRecord.Value && Records.TryGetValue(_aimed.GetInstanceID(), out var record) && record.Rounds > 0)
            {
                rows.Add($"paid {record.Payouts} of {record.Rounds} rounds  ({record.HitRate * 100f:0}%)");
                if (Math.Abs(record.Net) > 0.001) rows.Add($"net {record.Net:+#,##0;-#,##0;0}");
            }

            var anchor = new Rect(top.x - 60f, top.y, 120f, 1f);
            Hud.Plate(anchor, _title, rows.ToArray(), colour, playing);
        }
    }
}
