using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using GambleMenu.Core;
using GambleMenu.UI;
using HarmonyLib;
using UnityEngine;
using Object = UnityEngine.Object;

namespace GambleMenu.Mods
{
    /// <summary>
    /// Calls any method the game defines, by name.
    ///
    /// The natural partner to the class dump: once a dump shows AddMoney(long) or
    /// ForceWin(), this calls it. Where the field editor changes what a value is, this runs
    /// what the game does about it — which is usually the difference between a number that
    /// looks right and a game that has actually noticed.
    /// </summary>
    internal sealed class MethodInvoker : Mod
    {
        public override string Id => "dev.invoke";
        public override string Name => "Method caller";
        public override string Description => "Call any method in the game by name, with arguments.";
        public override Category Cat => Category.Developer;
        public override Authority Auth => Authority.SoloOnly;
        public override bool IsToggle => false;
        public override string[] Tags => new[] { "method", "call", "invoke", "function", "run", "execute" };

        private StringOption _typeName, _methodName, _args;
        private string _lastResult = "";

        protected override void Build()
        {
            _typeName = Opt(new StringOption("dev.invoke.type", "Class", "", "As it appears in a dump.") { Placeholder = "MoneyManager" });
            _methodName = Opt(new StringOption("dev.invoke.method", "Method", "") { Placeholder = "AddMoney" });
            _args = Opt(new StringOption("dev.invoke.args", "Arguments", "",
                "Comma separated, converted to whatever the method expects. Leave blank for none.")
            { Placeholder = "1000" });

            Act("Call it", Invoke, "Runs the method immediately.", destructive: true);

            Act("List methods on this class", () =>
            {
                var type = AccessTools.TypeByName(_typeName.Value?.Trim() ?? "");
                if (type == null) { Notifier.Error($"No class called '{_typeName.Value}'."); return; }

                var sb = new System.Text.StringBuilder();
                sb.AppendLine($"# {type.FullName}").AppendLine();
                foreach (var m in type.GetMethods(BindingFlags.Public | BindingFlags.NonPublic |
                                                  BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly)
                                      .OrderBy(m => m.Name, StringComparer.Ordinal))
                {
                    if (m.IsSpecialName) continue;
                    sb.AppendLine($"{(m.IsStatic ? "static " : "")}{m.ReturnType.Name} {m.Name}(" +
                                  string.Join(", ", m.GetParameters().Select(x => $"{x.ParameterType.Name} {x.Name}")) + ")");
                }
                Dump.Write($"methods-{type.Name}.txt", sb.ToString());
            });
        }

        private void Invoke()
        {
            string typeName = _typeName.Value?.Trim() ?? "";
            string methodName = _methodName.Value?.Trim() ?? "";
            if (typeName.Length == 0 || methodName.Length == 0)
            {
                Notifier.Warn("Give both a class and a method name.");
                return;
            }

            var type = AccessTools.TypeByName(typeName);
            if (type == null) { Notifier.Error($"No class called '{typeName}' is loaded."); return; }

            string[] rawArgs = string.IsNullOrWhiteSpace(_args.Value)
                ? Array.Empty<string>()
                : _args.Value.Split(',').Select(a => a.Trim()).ToArray();

            // Match on name and argument count first; the types are converted afterwards, so
            // "1000" can satisfy a long, an int or a float without the user knowing which.
            var candidates = type.GetMethods(BindingFlags.Public | BindingFlags.NonPublic |
                                             BindingFlags.Instance | BindingFlags.Static)
                                 .Where(m => m.Name == methodName && m.GetParameters().Length == rawArgs.Length)
                                 .ToList();

            if (candidates.Count == 0)
            {
                Notifier.Error($"'{typeName}' has no '{methodName}' taking {rawArgs.Length} argument(s).");
                return;
            }

            foreach (var method in candidates)
            {
                var parameters = method.GetParameters();
                var values = new object[rawArgs.Length];
                bool converted = true;

                for (int i = 0; i < rawArgs.Length; i++)
                {
                    if (Reflect.TryParse(parameters[i].ParameterType, rawArgs[i], out object v)) values[i] = v;
                    else { converted = false; break; }
                }
                if (!converted) continue;

                object target = null;
                if (!method.IsStatic)
                {
                    target = Object.FindObjectOfType(type);
                    if (target == null) { Notifier.Error($"No live instance of '{typeName}' to call this on."); return; }
                }

                try
                {
                    object result = method.Invoke(target, values);
                    _lastResult = result == null ? "(returned nothing)" : Reflect.Describe(result);
                    Notifier.Success($"{methodName} → {_lastResult}");
                }
                catch (TargetInvocationException ex)
                {
                    // The game's own exception matters far more than the reflection wrapper.
                    string inner = ex.InnerException?.Message ?? ex.Message;
                    _lastResult = $"threw: {inner}";
                    Notifier.Error($"{methodName} threw: {inner}");
                }
                catch (Exception ex)
                {
                    _lastResult = $"failed: {ex.Message}";
                    Notifier.Error($"Could not call {methodName}: {ex.Message}");
                }
                return;
            }

            Notifier.Error($"Arguments do not fit any overload of '{methodName}'.");
        }

        public override float BodyHeight(float width) => string.IsNullOrEmpty(_lastResult) ? 0f : 22f;

        public override void DrawBody(Rect area)
        {
            if (string.IsNullOrEmpty(_lastResult)) return;
            Draw.Label(area, "last result:  " + _lastResult, Styles.Small, Theme.P.TextMuted);
        }
    }

    /// <summary>
    /// Switches individual components off.
    ///
    /// The blunt instrument that solves problems nothing else can: a script that fights the
    /// camera, resets a value every frame, or plays an animation you would rather skip. It
    /// only ever toggles enabled, never destroys, so every change is undone on disable.
    /// </summary>
    internal sealed class ComponentToggler : Mod
    {
        public override string Id => "dev.components";
        public override string Name => "Component switch";
        public override string Description => "Find scripts by name and switch them off, one at a time.";
        public override Category Cat => Category.Developer;
        public override Authority Auth => Authority.SoloOnly;
        public override string[] Tags => new[] { "component", "script", "disable", "toggle", "behaviour", "off" };

        private const int VisibleRows = 7;

        private StringOption _filter;
        private BoolOption _onlyGameScripts;

        private readonly List<Behaviour> _found = new List<Behaviour>();
        private readonly List<Behaviour> _turnedOff = new List<Behaviour>();
        private int _scroll;
        private string _status = "Type part of a class name, then Search.";

        protected override void Build()
        {
            _filter = Opt(new StringOption("dev.components.filter", "Name contains", "",
                "Matched against the component's class name.") { Placeholder = "Spin" });
            _onlyGameScripts = Opt(new BoolOption("dev.components.gameonly", "Game scripts only", true,
                "Hides Unity's own components, which are almost never what you want to switch off."));

            Act("Search", Search);
            Act("Turn everything back on", RestoreAll, canRun: () => _turnedOff.Count > 0);
        }

        private void Search()
        {
            _found.Clear();
            _scroll = 0;
            string needle = _filter.Value?.Trim() ?? "";

            try
            {
                foreach (var b in Object.FindObjectsOfType<Behaviour>())
                {
                    if (b == null) continue;
                    var type = b.GetType();
                    var ns = type.Namespace;

                    if (ns != null && ns.StartsWith("GambleMenu", StringComparison.Ordinal)) continue;
                    if (_onlyGameScripts.Value && ns != null && ns.StartsWith("UnityEngine", StringComparison.Ordinal)) continue;
                    if (needle.Length > 0 && type.Name.IndexOf(needle, StringComparison.OrdinalIgnoreCase) < 0) continue;

                    _found.Add(b);
                    if (_found.Count >= 400) break;
                }
            }
            catch (Exception ex) { Notifier.Error($"Search failed: {ex.Message}"); return; }

            _status = _found.Count == 0
                ? $"Nothing matches '{needle}'."
                : $"{_found.Count} component(s) found.";
            Notifier.Info(_status);
        }

        private void RestoreAll()
        {
            int n = 0;
            foreach (var b in _turnedOff)
                if (b != null) { b.enabled = true; n++; }
            _turnedOff.Clear();
            Notifier.Success($"{n} component(s) switched back on.");
        }

        protected override void OnDisable() => RestoreAll();

        public override float BodyHeight(float width)
        {
            int rows = Mathf.Min(VisibleRows, Mathf.Max(_found.Count, 1));
            return 22f + rows * 21f + 6f;
        }

        public override void DrawBody(Rect area)
        {
            var p = Theme.P;
            Draw.Label(new Rect(area.x, area.y, area.width - 120f, 18f), _status, Styles.Small, p.TextMuted);

            if (_found.Count > VisibleRows)
            {
                if (Widgets.Button(new Rect(area.xMax - 116f, area.y - 2f, 54f, 20f), "▲", ButtonKind.Ghost, _scroll > 0, null, Id + ".up"))
                    _scroll = Mathf.Max(0, _scroll - VisibleRows);
                if (Widgets.Button(new Rect(area.xMax - 58f, area.y - 2f, 54f, 20f), "▼", ButtonKind.Ghost,
                                   _scroll + VisibleRows < _found.Count, null, Id + ".down"))
                    _scroll = Mathf.Min(_found.Count - 1, _scroll + VisibleRows);
            }

            float y = area.y + 22f;
            int shown = Mathf.Min(VisibleRows, _found.Count - _scroll);

            for (int i = 0; i < shown; i++)
            {
                var b = _found[_scroll + i];
                if (b == null) continue;

                var row = new Rect(area.x, y + i * 21f, area.width, 20f);
                if (row.Contains(Event.current.mousePosition)) Draw.Round(row, p.SurfaceHover, 4f);

                Draw.Label(new Rect(row.x + 6f, row.y, row.width * 0.46f, row.height),
                           Draw.Elide(b.GetType().Name, Styles.Small, row.width * 0.46f), Styles.Small,
                           b.enabled ? p.Text : p.TextFaint);
                Draw.Label(new Rect(row.x + row.width * 0.48f, row.y, row.width * 0.3f, row.height),
                           Draw.Elide(b.gameObject.name, Styles.Small, row.width * 0.3f), Styles.Small, p.TextFaint);

                bool on = Widgets.Switch(new Rect(row.xMax - 44f, row.y, 40f, row.height), Id + ".sw" + (_scroll + i),
                                         b.enabled, true, b.enabled ? "Switch this script off." : "Switch it back on.");
                if (on != b.enabled)
                {
                    b.enabled = on;
                    if (!on) { if (!_turnedOff.Contains(b)) _turnedOff.Add(b); }
                    else _turnedOff.Remove(b);
                }
            }
        }
    }

    /// <summary>
    /// Draws a value's recent history as a sparkline.
    ///
    /// A number on a HUD tells you what it is now; a line tells you what it does — whether a
    /// multiplier climbs smoothly or in steps, whether a meter is drifting, where the spikes
    /// are. That shape is the thing worth seeing, and it is invisible in text.
    /// </summary>
    internal sealed class ValueGraph : Mod
    {
        public override string Id => "dev.graph";
        public override string Name => "Value graph";
        public override string Description => "Plots any field over time, so you can see how it behaves.";
        public override Category Cat => Category.Developer;
        public override string[] Tags => new[] { "graph", "chart", "history", "plot", "watch", "trend" };

        private const int Samples = 160;

        private StringOption _target;
        private FloatOption _interval;
        private BoolOption _autoScale;

        private readonly double[] _history = new double[Samples];
        private int _count;
        private int _head;
        private float _nextSample;
        private FieldInfo _field;
        private Object _owner;
        private string _error;

        protected override void Build()
        {
            _target = Opt(new StringOption("dev.graph.target", "Field", "",
                "As Class.field — the same name the value finder or a dump gives you.")
            { Placeholder = "GameManager._timer" });
            _interval = Opt(new FloatOption("dev.graph.interval", "Sample every", 0.1f, 0.02f, 2f)
            { Step = 0.02f, Format = "0.00", Unit = "s" });
            _autoScale = Opt(new BoolOption("dev.graph.autoscale", "Fit to the data", true,
                "Off holds the scale steady, which makes small wobbles look small."));

            _target.Changed += () => { _field = null; _owner = null; _count = 0; _head = 0; _error = null; };
        }

        protected override void OnEnable() { _count = 0; _head = 0; }

        private bool Resolve()
        {
            if (_field != null && _owner != null) return true;

            string spec = _target.Value?.Trim() ?? "";
            int dot = spec.LastIndexOf('.');
            if (dot <= 0) { _error = "Write it as Class.field"; return false; }

            var type = AccessTools.TypeByName(spec.Substring(0, dot));
            if (type == null) { _error = $"No class '{spec.Substring(0, dot)}'"; return false; }

            _field = AccessTools.Field(type, spec.Substring(dot + 1));
            if (_field == null) { _error = $"No field '{spec.Substring(dot + 1)}'"; return false; }
            if (!Reflect.IsNumeric(_field.FieldType)) { _error = "That field is not a number"; _field = null; return false; }

            if (!_field.IsStatic)
            {
                _owner = Object.FindObjectOfType(type);
                if (_owner == null) { _error = $"No live '{type.Name}'"; return false; }
            }
            _error = null;
            return true;
        }

        protected override void OnUpdate()
        {
            if (Time.unscaledTime < _nextSample) return;
            _nextSample = Time.unscaledTime + _interval.Value;
            if (!Resolve()) return;

            try
            {
                object raw = _field.GetValue(_field.IsStatic ? null : (object)_owner);
                if (raw == null) return;
                _history[_head] = Convert.ToDouble(raw, CultureInfo.InvariantCulture);
                _head = (_head + 1) % Samples;
                if (_count < Samples) _count++;
            }
            catch (Exception ex) { _error = ex.Message; }
        }

        public override float BodyHeight(float width) => 92f;

        public override void DrawBody(Rect area)
        {
            var p = Theme.P;
            Draw.Card(area, p.SurfaceSunken, p.Border, 6f);

            if (_error != null)
            {
                Draw.Label(area, _error, Styles.SmallCentre, p.Warn);
                return;
            }
            if (_count < 2)
            {
                Draw.Label(area, "collecting…", Styles.SmallCentre, p.TextFaint);
                return;
            }

            double min = double.MaxValue, max = double.MinValue;
            for (int i = 0; i < _count; i++)
            {
                double v = _history[(_head - _count + i + Samples) % Samples];
                if (v < min) min = v;
                if (v > max) max = v;
            }

            if (!_autoScale.Value && min > 0) min = 0;
            // A flat line has no range to normalise against and would divide by zero.
            double span = max - min;
            if (span < 0.000001) { min -= 1; max += 1; span = max - min; }

            var plot = new Rect(area.x + 8f, area.y + 8f, area.width - 74f, area.height - 16f);
            float step = plot.width / (_count - 1);

            for (int i = 0; i < _count; i++)
            {
                double v = _history[(_head - _count + i + Samples) % Samples];
                float t = (float)((v - min) / span);
                float h = Mathf.Max(1f, plot.height * t);
                var bar = new Rect(plot.x + i * step, plot.yMax - h, Mathf.Max(1f, step - 0.5f), h);
                Draw.Fill(bar, Theme.Fade(Theme.Accent, 0.35f + 0.55f * t));
            }

            double latest = _history[(_head - 1 + Samples) % Samples];
            Draw.Label(new Rect(plot.xMax + 6f, area.y + 6f, 60f, 14f),
                       max.ToString("0.##", CultureInfo.InvariantCulture), Styles.TinyRight, p.TextFaint);
            Draw.Label(new Rect(plot.xMax + 6f, area.center.y - 7f, 60f, 14f),
                       latest.ToString("0.##", CultureInfo.InvariantCulture), Styles.SmallRightBold, Theme.Accent);
            Draw.Label(new Rect(plot.xMax + 6f, area.yMax - 20f, 60f, 14f),
                       min.ToString("0.##", CultureInfo.InvariantCulture), Styles.TinyRight, p.TextFaint);
        }

        protected override void OnDrawOverlay()
        {
            if (_field == null || _count == 0) return;
            Hud.Line($"{_target.Value}   {_history[(_head - 1 + Samples) % Samples].ToString("0.###", CultureInfo.InvariantCulture)}");
        }
    }
}
