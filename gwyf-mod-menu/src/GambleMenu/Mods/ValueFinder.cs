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
    /// <summary>One numeric field somewhere in the scene, and its value at the last scan.</summary>
    internal sealed class ScanEntry
    {
        public Component Owner;
        public FieldInfo Field;
        public double Last;

        public string TypeName => Owner == null ? "?" : Owner.GetType().Name;
        public string Label => $"{TypeName}.{Field.Name}";

        public bool TryRead(out double value)
        {
            value = 0;
            if (Owner == null) return false;
            try
            {
                object raw = Field.GetValue(Owner);
                if (raw == null) return false;
                value = Convert.ToDouble(raw, CultureInfo.InvariantCulture);
                return true;
            }
            catch { return false; }
        }

        public bool TryWrite(double value)
        {
            if (Owner == null) return false;
            try
            {
                Field.SetValue(Owner, Convert.ChangeType(value, Field.FieldType, CultureInfo.InvariantCulture));
                return true;
            }
            catch { return false; }
        }
    }

    /// <summary>
    /// Finds any number a game is holding, without knowing anything about the game.
    ///
    /// This is the search-and-narrow loop a memory scanner uses, done over managed reflection
    /// instead of raw addresses: scan for every field currently equal to your health, take a
    /// hit, scan again for the new value, and repeat until one candidate is left. Reflection
    /// beats address scanning here on every axis that matters — the survivors come back with
    /// real class and field names, nothing has to be re-found after a reload, and writing back
    /// goes through the runtime rather than into whatever happens to be at an address.
    ///
    /// It is the reason this menu is useful in a game nobody has mapped: no bindings, no class
    /// names, no dump. Whatever the number is, if the game keeps it in a field, this finds it.
    /// </summary>
    internal sealed class ValueFinder : Mod
    {
        public override string Id => "dev.valuefinder";
        public override string Name => "Value finder";
        public override string Description => "Search the whole game for a number, narrow it down, then freeze or change it.";
        public override Category Cat => Category.Developer;
        public override Authority Auth => Authority.SoloOnly;
        public override string[] Tags => new[] { "search", "scan", "find", "value", "health", "money", "ammo", "freeze", "cheat", "any game", "universal" };

        /// <summary>Above this the list is not worth keeping — the answer is to narrow first.</summary>
        private const int MaxCandidates = 120_000;
        private const int VisibleRows = 8;

        private static readonly Dictionary<Type, FieldInfo[]> FieldCache = new Dictionary<Type, FieldInfo[]>();

        private StringOption _value;
        private EnumOption _firstMode;
        private BoolOption _includeInactive;

        private readonly List<ScanEntry> _candidates = new List<ScanEntry>();
        private readonly List<ScanEntry> _frozen = new List<ScanEntry>();
        private readonly Dictionary<ScanEntry, double> _frozenAt = new Dictionary<ScanEntry, double>();
        private readonly List<ScanEntry> _pinned = new List<ScanEntry>();

        private int _scanCount;
        private string _status = "No scan yet.";
        private int _scroll;

        protected override void Build()
        {
            _firstMode = Opt(new EnumOption("dev.valuefinder.mode", "First scan finds",
                new[] { "fields equal to my value", "every number (unknown value)" }, 0,
                "Use the second when you cannot see the number — then narrow with increased/decreased."));
            _value = Opt(new StringOption("dev.valuefinder.value", "Value", "100",
                "The number to search for, or to write when setting.") { Placeholder = "100" });
            _includeInactive = Opt(new BoolOption("dev.valuefinder.inactive", "Include disabled objects", false,
                "Slower, and usually unnecessary — the value you want belongs to something active."));

            Act("First scan", FirstScan, "Searches every component in the scene.");
            Act("Reset", () =>
            {
                _candidates.Clear();
                _scanCount = 0;
                _status = "Cleared.";
            }, "Throws the candidate list away and starts over.");
            Act("Unfreeze all", () =>
            {
                _frozen.Clear();
                _frozenAt.Clear();
                Notifier.Info("Nothing is frozen now.");
            }, canRun: () => _frozen.Count > 0);
        }

        protected override void OnDisable()
        {
            // Frozen values are held by this mod's Update; leaving the list populated while it
            // is off would silently resume writing when it comes back on.
            _frozen.Clear();
            _frozenAt.Clear();
        }

        // --- scanning ---------------------------------------------------------------

        private static FieldInfo[] NumericFields(Type t)
        {
            if (FieldCache.TryGetValue(t, out var cached)) return cached;

            var fields = t.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)
                          .Where(f => Reflect.IsNumeric(f.FieldType))
                          .ToArray();
            FieldCache[t] = fields;
            return fields;
        }

        private void FirstScan()
        {
            bool wantExact = _firstMode.Index == 0;
            double target = 0;

            if (wantExact && !double.TryParse(_value.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out target))
            {
                Notifier.Error($"'{_value.Value}' is not a number.");
                return;
            }

            _candidates.Clear();
            _scroll = 0;

            MonoBehaviour[] all;
            try { all = Object.FindObjectsOfType<MonoBehaviour>(_includeInactive.Value); }
            catch (Exception ex) { Notifier.Error($"Scan failed: {ex.Message}"); return; }

            int scanned = 0;
            foreach (var mb in all)
            {
                if (mb == null) continue;
                var type = mb.GetType();
                // Our own fields would otherwise turn up in every result list.
                if (type.Namespace != null && type.Namespace.StartsWith("GambleMenu", StringComparison.Ordinal)) continue;

                foreach (var field in NumericFields(type))
                {
                    scanned++;
                    var entry = new ScanEntry { Owner = mb, Field = field };
                    if (!entry.TryRead(out double v)) continue;
                    if (wantExact && Math.Abs(v - target) > 0.0001) continue;

                    entry.Last = v;
                    _candidates.Add(entry);
                    if (_candidates.Count >= MaxCandidates) break;
                }
                if (_candidates.Count >= MaxCandidates) break;
            }

            _scanCount = 1;
            _status = $"{_candidates.Count:N0} of {scanned:N0} fields match.";

            if (_candidates.Count == 0)
                Notifier.Warn("Nothing holds that value right now. Check the number, or scan for every number instead.");
            else if (_candidates.Count >= MaxCandidates)
                Notifier.Warn($"Stopped at {MaxCandidates:N0} candidates — search for a specific value to narrow it.");
            else
                Notifier.Success($"{_candidates.Count:N0} candidates. Change the value in game, then scan again.");
        }

        /// <summary>Keeps only the candidates that still satisfy the comparison.</summary>
        private void NextScan(Func<double, double, bool> keep, string describe)
        {
            if (_candidates.Count == 0) { Notifier.Warn("Run a first scan before narrowing."); return; }

            double target = 0;
            bool needTarget = describe.StartsWith("=") || describe.StartsWith(">") || describe.StartsWith("<");
            if (needTarget && !double.TryParse(_value.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out target))
            {
                Notifier.Error($"'{_value.Value}' is not a number.");
                return;
            }

            int before = _candidates.Count;
            for (int i = _candidates.Count - 1; i >= 0; i--)
            {
                var entry = _candidates[i];
                if (!entry.TryRead(out double now)) { _candidates.RemoveAt(i); continue; }

                double compareAgainst = needTarget ? target : entry.Last;
                if (!keep(now, compareAgainst)) { _candidates.RemoveAt(i); continue; }
                entry.Last = now;
            }

            _scanCount++;
            _scroll = 0;
            _status = $"{_candidates.Count:N0} left after {_scanCount} scans  ({describe})";

            if (_candidates.Count == 0)
                Notifier.Warn("Nothing survived that scan. Reset and start again — the value may not be a plain number.");
            else if (_candidates.Count == 1)
                Notifier.Success($"Found it: {_candidates[0].Label}");
            else
                Notifier.Info($"{_candidates.Count:N0} candidates left.");
        }

        // --- freezing ---------------------------------------------------------------

        protected override void OnUpdate()
        {
            for (int i = _frozen.Count - 1; i >= 0; i--)
            {
                var entry = _frozen[i];
                if (entry.Owner == null)
                {
                    // The object was destroyed — a scene change, or the thing died.
                    _frozen.RemoveAt(i);
                    _frozenAt.Remove(entry);
                    continue;
                }
                if (_frozenAt.TryGetValue(entry, out double held)) entry.TryWrite(held);
            }
        }

        protected override void OnDrawOverlay()
        {
            foreach (var entry in _pinned)
            {
                if (entry.Owner == null) continue;
                if (!entry.TryRead(out double v)) continue;
                bool frozen = _frozenAt.ContainsKey(entry);
                Hud.Line($"{entry.Label}   {v.ToString("0.###", CultureInfo.InvariantCulture)}{(frozen ? "   [frozen]" : "")}");
            }
        }

        // --- panel ------------------------------------------------------------------

        public override float BodyHeight(float width)
        {
            int rows = Mathf.Min(VisibleRows, Mathf.Max(_candidates.Count, 1));
            return 26f + 30f + rows * 22f + 20f;
        }

        public override void DrawBody(Rect area)
        {
            var p = Theme.P;
            float y = area.y;

            // --- narrowing buttons
            var ops = new (string label, string tip, Func<double, double, bool> test)[]
            {
                ("= value",   "Kept if it now equals the value above.",      (now, t) => Math.Abs(now - t) < 0.0001),
                ("changed",   "Kept if it moved at all since the last scan.", (now, prev) => Math.Abs(now - prev) > 0.0001),
                ("unchanged", "Kept if it did not move.",                     (now, prev) => Math.Abs(now - prev) <= 0.0001),
                ("increased", "Kept if it went up.",                          (now, prev) => now > prev),
                ("decreased", "Kept if it went down.",                        (now, prev) => now < prev),
            };

            float bw = (area.width - (ops.Length - 1) * 5f) / ops.Length;
            for (int i = 0; i < ops.Length; i++)
            {
                var r = new Rect(area.x + i * (bw + 5f), y, bw, 24f);
                if (Widgets.Button(r, ops[i].label, ButtonKind.Normal, _candidates.Count > 0, ops[i].tip,
                                   Id + ".op" + i))
                {
                    var op = ops[i];
                    NextScan(op.test, op.label);
                }
            }
            y += 30f;

            Draw.Label(new Rect(area.x, y, area.width - 120f, 18f), _status, Styles.Small, p.TextMuted);
            if (_candidates.Count > VisibleRows)
            {
                if (Widgets.Button(new Rect(area.xMax - 116f, y - 2f, 54f, 20f), "▲", ButtonKind.Ghost, _scroll > 0,
                                   "Earlier results", Id + ".up"))
                    _scroll = Mathf.Max(0, _scroll - VisibleRows);
                if (Widgets.Button(new Rect(area.xMax - 58f, y - 2f, 54f, 20f), "▼", ButtonKind.Ghost,
                                   _scroll + VisibleRows < _candidates.Count, "More results", Id + ".down"))
                    _scroll = Mathf.Min(_candidates.Count - 1, _scroll + VisibleRows);
            }
            y += 22f;

            // --- results
            if (_candidates.Count == 0)
            {
                Draw.Label(new Rect(area.x, y, area.width, 20f),
                           "Type the number you can see in game, press First scan, change it, then narrow.",
                           Styles.Small, p.TextFaint);
                return;
            }

            int shown = Mathf.Min(VisibleRows, _candidates.Count - _scroll);
            for (int i = 0; i < shown; i++)
            {
                var entry = _candidates[_scroll + i];
                var row = new Rect(area.x, y + i * 22f, area.width, 21f);
                bool hover = row.Contains(Event.current.mousePosition);
                if (hover) Draw.Round(row, p.SurfaceHover, 4f);

                bool frozen = _frozenAt.ContainsKey(entry);
                bool pinned = _pinned.Contains(entry);

                entry.TryRead(out double v);

                Draw.Label(new Rect(row.x + 6f, row.y, row.width * 0.52f, row.height),
                           Draw.Elide(entry.Label, Styles.Small, row.width * 0.52f), Styles.Small,
                           frozen ? Theme.Accent : p.Text);

                Draw.Label(new Rect(row.x + row.width * 0.54f, row.y, row.width * 0.18f, row.height),
                           v.ToString("0.###", CultureInfo.InvariantCulture), Styles.SmallRight, p.TextMuted);

                float bx = row.xMax - 168f;
                if (Widgets.Button(new Rect(bx, row.y + 1f, 40f, 19f), pinned ? "unpin" : "pin",
                                   ButtonKind.Ghost, true, "Show this value on screen while you play.",
                                   Id + ".pin" + (_scroll + i)))
                {
                    if (pinned) _pinned.Remove(entry); else _pinned.Add(entry);
                }

                if (Widgets.Button(new Rect(bx + 44f, row.y + 1f, 54f, 19f), frozen ? "thaw" : "freeze",
                                   frozen ? ButtonKind.Primary : ButtonKind.Ghost, true,
                                   "Hold this value where it is, every frame.", Id + ".frz" + (_scroll + i)))
                {
                    if (frozen)
                    {
                        _frozen.Remove(entry);
                        _frozenAt.Remove(entry);
                    }
                    else
                    {
                        _frozen.Add(entry);
                        _frozenAt[entry] = v;
                        Notifier.Success($"{entry.Label} held at {v.ToString("0.###", CultureInfo.InvariantCulture)}.");
                    }
                }

                if (Widgets.Button(new Rect(bx + 102f, row.y + 1f, 44f, 19f), "set", ButtonKind.Ghost, true,
                                   "Write the value from the box above into this field.", Id + ".set" + (_scroll + i)))
                {
                    if (!double.TryParse(_value.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out double target))
                        Notifier.Error($"'{_value.Value}' is not a number.");
                    else if (!entry.TryWrite(target))
                        Notifier.Error($"{entry.Label} refused the write.");
                    else
                    {
                        if (_frozenAt.ContainsKey(entry)) _frozenAt[entry] = target;
                        Notifier.Success($"{entry.Label} = {target.ToString("0.###", CultureInfo.InvariantCulture)}");
                    }
                }
            }
        }
    }
}
