using System;
using System.Collections.Generic;
using System.Globalization;
using GambleMenu.Core;
using UnityEngine;

namespace GambleMenu.UI
{
    internal enum ButtonKind { Normal, Primary, Danger, Ghost }

    /// <summary>
    /// The menu's controls. Each one draws itself and returns whether the user changed it.
    ///
    /// Two pieces of state outlive a single call and are therefore static: the open dropdown
    /// and the option currently capturing a keypress. Both are single-instance by nature —
    /// two dropdowns cannot be open at once — so parking them here keeps every call site
    /// from threading UI state it does not care about.
    /// </summary>
    internal static class Widgets
    {
        /// <summary>Drawn after everything else so popups are not clipped by later content.</summary>
        private static readonly List<Action> _overlays = new List<Action>();

        private static string _openDropdown;

        /// <summary>
        /// Accumulated origin of the GUI groups we are drawing inside.
        ///
        /// Overlays are flushed after every group has closed, so a rect captured in
        /// group-local coordinates would draw at the wrong place on screen. Callers that open
        /// a group declare it here and the overlay adds the offset back.
        /// </summary>
        private static Vector2 _groupOffset;
        private static KeyOption _capturing;
        private static string _hoverTooltip;

        public static bool IsCapturingKey => _capturing != null;
        public static string HoverTooltip => _hoverTooltip;

        /// <summary>Records a tooltip for this frame when the cursor is inside
        /// <paramref name="over"/>. Used for hover targets that are not themselves controls.</summary>
        public static void SetTooltip(Rect over, string tooltip) => Tip(over, tooltip);

        public static void BeginFrame()
        {
            _overlays.Clear();
            _hoverTooltip = null;
            _groupOffset = Vector2.zero;
        }

        public static void PushGroup(Rect area) => _groupOffset += new Vector2(area.x, area.y);

        public static void PopGroup(Rect area) => _groupOffset -= new Vector2(area.x, area.y);

        public static void FlushOverlays()
        {
            // Copied because an overlay may queue another (a submenu inside a dropdown).
            var pending = _overlays.ToArray();
            _overlays.Clear();
            foreach (var draw in pending) draw();
        }

        public static void CloseDropdown() => _openDropdown = null;

        public static void CancelCapture()
        {
            _capturing = null;
        }

        /// <summary>Feeds a key event to a pending rebind. Returns true when the event was
        /// consumed, so the caller does not also treat it as a menu shortcut.</summary>
        public static bool ConsumeKeyForCapture(Event e)
        {
            if (_capturing == null || e.type != EventType.KeyDown) return false;

            if (e.keyCode == KeyCode.Escape) { _capturing = null; Notifier.Info("Rebind cancelled."); e.Use(); return true; }
            if (e.keyCode == KeyCode.Backspace || e.keyCode == KeyCode.Delete)
            {
                _capturing.Value = KeyCode.None;
                _capturing = null;
                Notifier.Info("Hotkey cleared.");
                e.Use();
                return true;
            }
            if (e.keyCode == KeyCode.None) return false;

            _capturing.Value = e.keyCode;
            Notifier.Success($"Bound to {e.keyCode}.");
            _capturing = null;
            e.Use();
            return true;
        }

        private static bool Hovered(Rect r) => r.Contains(Event.current.mousePosition);

        private static void Tip(Rect r, string tooltip)
        {
            if (!string.IsNullOrEmpty(tooltip) && Hovered(r)) _hoverTooltip = tooltip;
        }

        private static bool Clicked(Rect r)
        {
            var e = Event.current;
            if (e.type != EventType.MouseDown || e.button != 0 || !r.Contains(e.mousePosition)) return false;
            e.Use();
            return true;
        }

        // --- switch -----------------------------------------------------------------

        /// <summary>The on/off pill. Height is fixed at 20 so it lines up with a text row.</summary>
        public static bool Switch(Rect area, string key, bool value, bool interactable = true, string tooltip = null)
        {
            const float w = 38f, h = 20f;
            var r = new Rect(area.x + area.width - w, area.y + (area.height - h) * 0.5f, w, h);
            var p = Theme.P;

            bool hover = interactable && Hovered(r);
            float on = Anim.To(key + ".sw", value ? 1f : 0f, 16f);
            float hl = Anim.To(key + ".swh", hover ? 1f : 0f, 18f);

            Color track = Color.Lerp(p.Track, Theme.Accent, on);
            if (!interactable) track = Theme.Fade(p.Track, 0.5f);
            else if (hl > 0f) track = Color.Lerp(track, Color.Lerp(track, Color.white, 0.12f), hl);

            Draw.Round(r, track, h * 0.5f);

            float knobSize = h - 6f;
            float travel = w - knobSize - 6f;
            var knob = new Rect(r.x + 3f + travel * on, r.y + 3f, knobSize, knobSize);
            Draw.Round(knob, interactable ? Color.white : Theme.Fade(Color.white, 0.55f), knobSize * 0.5f);

            Tip(r, tooltip);
            if (!interactable) return value;
            return Clicked(r) ? !value : value;
        }

        // --- buttons ----------------------------------------------------------------

        /// <summary>
        /// A button. <paramref name="key"/> identifies it for hover animation and must be
        /// stable across frames — deriving one from the rect would mint a new entry on every
        /// scroll and leak the animation cache for the rest of the session.
        /// </summary>
        public static bool Button(Rect r, string label, ButtonKind kind = ButtonKind.Normal, bool enabled = true,
                                  string tooltip = null, string key = null)
        {
            var p = Theme.P;
            key = key ?? label;
            bool hover = enabled && Hovered(r);
            float hl = Anim.To(key + ".btn", hover ? 1f : 0f, 18f);

            Color fill, text, border;
            switch (kind)
            {
                case ButtonKind.Primary:
                    fill = Theme.Accent; text = Theme.OnAccent; border = Theme.Accent;
                    break;
                case ButtonKind.Danger:
                    fill = Theme.Fade(p.Danger, 0.16f); text = p.Danger; border = Theme.Fade(p.Danger, 0.55f);
                    break;
                case ButtonKind.Ghost:
                    fill = Color.clear; text = p.TextMuted; border = Color.clear;
                    break;
                default:
                    fill = p.SurfaceAlt; text = p.Text; border = p.Border;
                    break;
            }

            if (!enabled)
            {
                fill = Theme.Fade(fill, 0.4f);
                text = Theme.Fade(text, 0.45f);
                border = Theme.Fade(border, 0.4f);
            }
            else if (hl > 0f)
            {
                fill = Color.Lerp(fill, Color.Lerp(fill, p.Text, 0.10f), hl);
                if (kind == ButtonKind.Ghost) { fill = Theme.Fade(p.SurfaceHover, hl); text = p.Text; }
            }

            Draw.Card(r, fill, border, 6f);
            Draw.Label(r, label, Styles.BodyCentre, text);
            Tip(r, tooltip);

            return enabled && Clicked(r);
        }

        // --- sliders ----------------------------------------------------------------

        public static bool Slider(Rect r, FloatOption opt, bool interactable = true)
        {
            float t = Mathf.InverseLerp(opt.Min, opt.Max, opt.Value);
            float nt = SliderTrack(r, opt.Key, t, interactable, opt.Display);
            if (Mathf.Approximately(nt, t)) return false;
            opt.Value = Mathf.Lerp(opt.Min, opt.Max, nt);
            return true;
        }

        public static bool Slider(Rect r, IntOption opt, bool interactable = true)
        {
            float span = Mathf.Max(1, opt.Max - opt.Min);
            float t = (opt.Value - opt.Min) / span;
            float nt = SliderTrack(r, opt.Key, t, interactable, opt.Value.ToString(CultureInfo.InvariantCulture) + opt.Unit);
            int nv = Mathf.RoundToInt(opt.Min + nt * span);
            if (nv == opt.Value) return false;
            opt.Value = nv;
            return true;
        }

        /// <summary>
        /// Shared slider body. Returns the (possibly unchanged) normalised position.
        ///
        /// Dragging is tracked by control id rather than by "is the mouse over me", so the
        /// value keeps following the cursor after it leaves the track — the behaviour every
        /// other slider in every other program has.
        /// </summary>
        private static float SliderTrack(Rect r, string key, float t, bool interactable, string display)
        {
            var p = Theme.P;
            var e = Event.current;
            int id = GUIUtility.GetControlID(FocusType.Passive, r);

            const float trackH = 5f;
            float labelW = 62f;
            var bar = new Rect(r.x, r.y + (r.height - trackH) * 0.5f, Mathf.Max(10f, r.width - labelW), trackH);
            var valueRect = new Rect(bar.xMax + 8f, r.y, labelW - 8f, r.height);

            if (interactable)
            {
                switch (e.GetTypeForControl(id))
                {
                    case EventType.MouseDown when e.button == 0 && r.Contains(e.mousePosition):
                        GUIUtility.hotControl = id;
                        t = Mathf.Clamp01((e.mousePosition.x - bar.x) / bar.width);
                        e.Use();
                        break;
                    case EventType.MouseDrag when GUIUtility.hotControl == id:
                        t = Mathf.Clamp01((e.mousePosition.x - bar.x) / bar.width);
                        e.Use();
                        break;
                    case EventType.MouseUp when GUIUtility.hotControl == id:
                        GUIUtility.hotControl = 0;
                        e.Use();
                        break;
                }
            }

            bool active = GUIUtility.hotControl == id;
            float hl = Anim.To(key + ".sl", (interactable && (Hovered(r) || active)) ? 1f : 0f, 18f);

            Draw.Round(bar, interactable ? p.Track : Theme.Fade(p.Track, 0.5f), trackH * 0.5f);
            var fill = new Rect(bar.x, bar.y, bar.width * Mathf.Clamp01(t), trackH);
            Draw.Round(fill, interactable ? Theme.Accent : Theme.Fade(Theme.Accent, 0.45f), trackH * 0.5f);

            float knob = 13f + hl * 2f;
            var knobRect = new Rect(bar.x + bar.width * Mathf.Clamp01(t) - knob * 0.5f, bar.y + trackH * 0.5f - knob * 0.5f, knob, knob);
            Draw.Round(knobRect, interactable ? Color.white : Theme.Fade(Color.white, 0.5f), knob * 0.5f);

            Draw.Label(valueRect, display, Styles.SmallRight, interactable ? p.TextMuted : p.TextFaint);
            return t;
        }

        // --- text and number fields -------------------------------------------------

        public static string TextField(Rect r, string id, string value, string placeholder = null, bool interactable = true)
        {
            var p = Theme.P;
            bool focused = GUI.GetNameOfFocusedControl() == id;
            float f = Anim.To(id + ".fld", focused ? 1f : 0f, 18f);

            Draw.Card(r, p.SurfaceSunken, Color.Lerp(p.Border, Theme.Accent, f), 6f);

            GUI.SetNextControlName(id);
            var prevColor = GUI.color;
            GUI.color = Color.white;
            Styles.Field.normal.textColor = interactable ? p.Text : p.TextFaint;
            Styles.Field.focused.textColor = p.Text;
            string result = interactable ? GUI.TextField(r, value ?? string.Empty, Styles.Field) : value;
            GUI.color = prevColor;

            if (!focused && string.IsNullOrEmpty(value) && !string.IsNullOrEmpty(placeholder))
                Draw.Label(new Rect(r.x + 8f, r.y, r.width - 16f, r.height), placeholder, Styles.Body, p.TextFaint);

            return result;
        }

        /// <summary>
        /// Editing surface for a 64-bit value.
        ///
        /// The buffer is only committed on Enter or focus loss, so typing "1000" on the way
        /// to "1000000" does not momentarily set the balance to a thousand — which, with a
        /// mod that writes every frame, would be a visible and irreversible edit.
        /// </summary>
        public static void LongField(Rect r, LongOption opt, bool interactable = true)
        {
            var p = Theme.P;
            string id = opt.Key + ".long";
            float presetW = opt.Presets.Length > 0 ? Mathf.Min(150f, opt.Presets.Length * 42f) : 0f;
            var fieldRect = new Rect(r.x, r.y, r.width - presetW - (presetW > 0f ? 6f : 0f), r.height);

            bool wasFocused = GUI.GetNameOfFocusedControl() == id;
            string typed = TextField(fieldRect, id, opt.Buffer, "0", interactable);
            if (!ReferenceEquals(typed, opt.Buffer) && typed != opt.Buffer) opt.Buffer = typed;

            var e = Event.current;
            bool enter = e.type == EventType.KeyDown && (e.keyCode == KeyCode.Return || e.keyCode == KeyCode.KeypadEnter) && wasFocused;
            bool blurred = wasFocused && GUI.GetNameOfFocusedControl() != id;

            if (interactable && (enter || blurred))
            {
                if (!opt.CommitBuffer())
                {
                    Notifier.Warn($"'{opt.Buffer}' is not a whole number — {opt.Label} left at {opt.Value}.");
                    opt.Buffer = opt.Value.ToString(CultureInfo.InvariantCulture);
                }
                if (enter) { e.Use(); GUIUtility.keyboardControl = 0; }
            }

            for (int i = 0; i < opt.Presets.Length && presetW > 0f; i++)
            {
                float bw = presetW / opt.Presets.Length;
                var br = new Rect(fieldRect.xMax + 6f + bw * i, r.y, bw - 2f, r.height);
                if (Button(br, Compact(opt.Presets[i]), ButtonKind.Ghost, interactable,
                           $"Set to {opt.Presets[i].ToString("N0", CultureInfo.InvariantCulture)}"))
                    opt.Value = opt.Presets[i];
            }
        }

        /// <summary>1 234 567 → "1.2M". Twelve-digit balances do not fit in a button.</summary>
        public static string Compact(long v)
        {
            double a = Math.Abs((double)v);
            string sign = v < 0 ? "-" : "";
            if (a >= 1e12) return sign + (a / 1e12).ToString("0.##", CultureInfo.InvariantCulture) + "T";
            if (a >= 1e9)  return sign + (a / 1e9 ).ToString("0.##", CultureInfo.InvariantCulture) + "B";
            if (a >= 1e6)  return sign + (a / 1e6 ).ToString("0.##", CultureInfo.InvariantCulture) + "M";
            if (a >= 1e3)  return sign + (a / 1e3 ).ToString("0.##", CultureInfo.InvariantCulture) + "K";
            return v.ToString(CultureInfo.InvariantCulture);
        }

        // --- dropdown ---------------------------------------------------------------

        /// <summary>
        /// Draws a select. Returns nothing: the choice is committed from a deferred overlay
        /// one layer later, so no honest "changed" answer exists during this call — read
        /// <see cref="EnumOption.Index"/> on the following frame instead.
        /// </summary>
        public static void Dropdown(Rect r, EnumOption opt, bool interactable = true)
        {
            var p = Theme.P;
            string key = opt.Key + ".dd";
            bool open = _openDropdown == key;
            bool hover = interactable && Hovered(r);
            float hl = Anim.To(key + ".h", hover || open ? 1f : 0f, 18f);

            Draw.Card(r, Color.Lerp(p.SurfaceSunken, p.SurfaceHover, hl),
                      open ? Theme.Accent : p.Border, 6f);
            Draw.Label(new Rect(r.x + 9f, r.y, r.width - 28f, r.height), opt.Selected, Styles.Body,
                       interactable ? p.Text : p.TextFaint);
            Draw.Chevron(new Rect(r.xMax - 22f, r.y, 18f, r.height), p.TextMuted, open ? 180f : 0f);

            if (interactable && Clicked(r)) _openDropdown = open ? null : key;

            if (_openDropdown != key) return;

            int chosen = -1;
            var anchor = new Rect(r.x + _groupOffset.x, r.y + _groupOffset.y, r.width, r.height);
            _overlays.Add(() =>
            {
                var r2 = anchor;
                const float rowH = 26f;
                float listH = opt.Choices.Length * rowH + 8f;
                // Flip above the control when there is not room below, so the last category
                // in a list is still selectable.
                float y = r2.yMax + 4f;
                if (y + listH > Screen.height / Mathf.Max(0.01f, Settings.Scale.Value)) y = r2.y - listH - 4f;
                var list = new Rect(r2.x, y, r2.width, listH);

                Draw.Shadow(list, Theme.P.Shadow, 8f, 10f, 4);
                Draw.Card(list, Theme.P.SurfaceAlt, Theme.P.BorderStrong, 8f);

                for (int i = 0; i < opt.Choices.Length; i++)
                {
                    var row = new Rect(list.x + 4f, list.y + 4f + i * rowH, list.width - 8f, rowH);
                    bool rowHover = Hovered(row);
                    bool selected = i == opt.Index;
                    if (rowHover) Draw.Round(row, Theme.P.SurfaceHover, 5f);
                    if (selected) Draw.Round(new Rect(row.x + 2f, row.y + 6f, 3f, rowH - 12f), Theme.Accent, 1.5f);

                    Draw.Label(new Rect(row.x + 10f, row.y, row.width - 30f, rowH), opt.Choices[i], Styles.Body,
                               selected ? Theme.P.Text : Theme.P.TextMuted);
                    if (selected) Draw.Check(new Rect(row.xMax - 20f, row.y, 14f, rowH), Theme.Accent);

                    if (Clicked(row)) { chosen = i; }
                }

                // Any click outside the list dismisses it.
                if (Event.current.type == EventType.MouseDown && !list.Contains(Event.current.mousePosition) && !r2.Contains(Event.current.mousePosition))
                    _openDropdown = null;

                if (chosen >= 0)
                {
                    opt.Index = chosen;
                    _openDropdown = null;
                }
            });
        }

        // --- colour -----------------------------------------------------------------

        /// <summary>Swatch plus RGBA sliders. Deliberately not a colour wheel: a wheel needs
        /// a generated gradient texture per frame and buys nothing at this size.</summary>
        public static void ColorField(Rect r, ColorOption opt, ref bool expanded)
        {
            var p = Theme.P;
            const float swatch = 26f;
            var sw = new Rect(r.x + r.width - swatch, r.y + (r.height - 18f) * 0.5f, swatch, 18f);

            Draw.Card(sw, opt.Value, p.BorderStrong, 4f);
            if (Clicked(sw)) expanded = !expanded;
            Tip(sw, "Click to edit the colour channels.");
        }

        public static void ColorChannels(Rect r, ColorOption opt)
        {
            var p = Theme.P;
            string[] names = { "R", "G", "B", "A" };
            float[] values = { opt.Value.r, opt.Value.g, opt.Value.b, opt.Value.a };
            float rowH = r.height / 4f;
            bool changed = false;

            for (int i = 0; i < 4; i++)
            {
                var row = new Rect(r.x, r.y + rowH * i, r.width, rowH);
                Draw.Label(new Rect(row.x, row.y, 16f, row.height), names[i], Styles.Small, p.TextMuted);

                var bar = new Rect(row.x + 20f, row.y, row.width - 20f, row.height);
                int id = GUIUtility.GetControlID(FocusType.Passive, bar);
                var e = Event.current;
                const float trackH = 5f;
                var track = new Rect(bar.x, bar.y + (bar.height - trackH) * 0.5f, bar.width - 40f, trackH);

                switch (e.GetTypeForControl(id))
                {
                    case EventType.MouseDown when e.button == 0 && bar.Contains(e.mousePosition):
                        GUIUtility.hotControl = id;
                        values[i] = Mathf.Clamp01((e.mousePosition.x - track.x) / track.width);
                        changed = true; e.Use();
                        break;
                    case EventType.MouseDrag when GUIUtility.hotControl == id:
                        values[i] = Mathf.Clamp01((e.mousePosition.x - track.x) / track.width);
                        changed = true; e.Use();
                        break;
                    case EventType.MouseUp when GUIUtility.hotControl == id:
                        GUIUtility.hotControl = 0; e.Use();
                        break;
                }

                Draw.Round(track, p.Track, trackH * 0.5f);
                Color chan = i == 0 ? new Color(1f, 0.3f, 0.3f) : i == 1 ? new Color(0.3f, 1f, 0.4f)
                           : i == 2 ? new Color(0.35f, 0.6f, 1f) : Color.white;
                Draw.Round(new Rect(track.x, track.y, track.width * values[i], trackH), chan, trackH * 0.5f);
                var knob = new Rect(track.x + track.width * values[i] - 6f, track.y - 3.5f, 12f, 12f);
                Draw.Round(knob, Color.white, 6f);
                Draw.Label(new Rect(track.xMax + 6f, row.y, 34f, row.height),
                           values[i].ToString("0.00", CultureInfo.InvariantCulture), Styles.SmallRight, p.TextFaint);
            }

            if (changed) opt.Value = new Color(values[0], values[1], values[2], values[3]);
        }

        // --- key binding ------------------------------------------------------------

        public static void KeyBind(Rect area, KeyOption opt, bool interactable = true)
        {
            var p = Theme.P;
            const float w = 96f;
            var r = new Rect(area.x + area.width - w, area.y + (area.height - 22f) * 0.5f, w, 22f);
            bool capturing = _capturing == opt;
            bool hover = interactable && Hovered(r);
            float hl = Anim.To(opt.Key + ".kb", hover || capturing ? 1f : 0f, 18f);

            Color border = capturing ? Theme.Accent : Color.Lerp(p.Border, p.BorderStrong, hl);
            Draw.Card(r, capturing ? Theme.Fade(Theme.Accent, 0.14f) : p.SurfaceSunken, border, 5f);
            Draw.Label(r, capturing ? "press a key…" : opt.Display, Styles.SmallCentre,
                       capturing ? Theme.Accent : (opt.IsBound ? p.Text : p.TextFaint));

            Tip(r, capturing
                ? "Esc cancels · Backspace clears"
                : "Click, then press the key you want. Backspace clears it.");

            if (interactable && Clicked(r)) _capturing = capturing ? null : opt;
        }

        // --- assorted ---------------------------------------------------------------

        public static void Badge(Rect r, string text, Color color, Color? fillOverride = null)
        {
            Draw.Card(r, fillOverride ?? Theme.Fade(color, 0.14f), Theme.Fade(color, 0.45f), 4f);
            Draw.Label(r, text, Styles.SmallCentre, color);
        }

        public static int Segmented(Rect r, string key, string[] labels, int index)
        {
            var p = Theme.P;
            Draw.Card(r, p.SurfaceSunken, p.Border, 7f);
            float seg = (r.width - 4f) / labels.Length;
            float animated = Anim.To(key + ".seg", index, 20f);

            var sel = new Rect(r.x + 2f + seg * animated, r.y + 2f, seg, r.height - 4f);
            Draw.Round(sel, Theme.Accent, 5f);

            int result = index;
            for (int i = 0; i < labels.Length; i++)
            {
                var cell = new Rect(r.x + 2f + seg * i, r.y + 2f, seg, r.height - 4f);
                Draw.Label(cell, labels[i], Styles.SmallCentre, i == index ? Theme.OnAccent : p.TextMuted);
                if (Clicked(cell)) result = i;
            }
            return result;
        }

        public static string SearchBox(Rect r, string value)
        {
            var p = Theme.P;
            const string id = "gm.search";
            bool focused = GUI.GetNameOfFocusedControl() == id;
            float f = Anim.To("search.f", focused ? 1f : 0f, 18f);

            Draw.Card(r, p.SurfaceSunken, Color.Lerp(p.Border, Theme.Accent, f), 7f);

            // Magnifier: a ring with a stem.
            var glass = new Rect(r.x + 10f, r.y + (r.height - 12f) * 0.5f, 11f, 11f);
            Draw.Outline(glass, p.TextFaint, 5.5f, 1.4f);
            var stem = new Rect(glass.xMax - 2f, glass.yMax - 2f, 5f, 1.4f);
            var m = GUI.matrix;
            GUIUtility.RotateAroundPivot(45f, new Vector2(stem.x, stem.y));
            Draw.Round(stem, p.TextFaint, 0.7f);
            GUI.matrix = m;

            var field = new Rect(r.x + 28f, r.y, r.width - 56f, r.height);
            GUI.SetNextControlName(id);
            Styles.Field.normal.textColor = p.Text;
            Styles.Field.focused.textColor = p.Text;
            string result = GUI.TextField(field, value ?? string.Empty, Styles.Field);

            if (string.IsNullOrEmpty(result) && !focused)
                Draw.Label(field, "Search mods…", Styles.Body, p.TextFaint);

            if (!string.IsNullOrEmpty(result))
            {
                var clear = new Rect(r.xMax - 26f, r.y, 22f, r.height);
                if (Hovered(clear)) Draw.Round(new Rect(clear.x + 2f, clear.y + 5f, 18f, r.height - 10f), p.SurfaceHover, 4f);
                Draw.Cross(clear, p.TextMuted, 1.5f);
                if (Clicked(clear)) { result = string.Empty; GUIUtility.keyboardControl = 0; }
            }
            return result;
        }

        /// <summary>Row separator that stops short of the card edges.</summary>
        public static void Divider(Rect r, float inset = 0f)
            => Draw.HLine(r.x + inset, r.y, r.width - inset * 2f, Theme.Fade(Theme.P.Border, 0.8f));
    }
}
