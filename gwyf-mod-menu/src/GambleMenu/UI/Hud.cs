using System.Collections.Generic;
using GambleMenu.Core;
using UnityEngine;

namespace GambleMenu.UI
{
    /// <summary>
    /// The always-on overlay: a stacked readout panel and world-space markers.
    ///
    /// Lines are collected from every enabled mod and drawn once as a single panel, so two
    /// mods that both want to show something do not draw on top of each other — the usual
    /// failure when each mod renders its own corner box.
    /// </summary>
    internal static class Hud
    {
        private static readonly List<string> _lines = new List<string>();

        public static void Begin() => _lines.Clear();

        /// <summary>Queues one line of readout. Safe to call from any mod's overlay pass.</summary>
        public static void Line(string text)
        {
            if (!string.IsNullOrEmpty(text)) _lines.Add(text);
        }

        public static void End()
        {
            if (_lines.Count == 0) return;
            Styles.Build();

            var p = Theme.P;
            float width = 0f;
            foreach (var line in _lines) width = Mathf.Max(width, Draw.TextWidth(line, Styles.Small));
            width += 26f;

            const float lineH = 18f;
            float height = _lines.Count * lineH + 16f;
            var box = new Rect(16f, 16f, width, height);

            Draw.Card(box, Theme.Fade(p.Surface, 0.88f), Theme.Fade(p.Border, 0.9f), 8f);
            Draw.Round(new Rect(box.x + 1f, box.y + 8f, 3f, box.height - 16f), Theme.Accent, 1.5f);

            for (int i = 0; i < _lines.Count; i++)
                Draw.Label(new Rect(box.x + 14f, box.y + 8f + i * lineH, box.width - 22f, lineH),
                           _lines[i], Styles.Small, p.Text);
        }

        // --- world space ------------------------------------------------------------

        /// <summary>
        /// Projects a world point to screen space.
        ///
        /// Returns false for anything behind the camera: Camera.WorldToScreenPoint happily
        /// returns a plausible-looking coordinate for points behind the lens, which is how
        /// ESP implementations end up drawing mirrored boxes for things at your back.
        /// </summary>
        public static bool Project(Camera cam, Vector3 world, out Vector2 screen)
        {
            screen = Vector2.zero;
            if (cam == null) return false;

            Vector3 p = cam.WorldToScreenPoint(world);
            if (p.z <= 0.01f) return false;

            screen = new Vector2(p.x, Screen.height - p.y);
            return true;
        }

        public static void Marker(Vector2 screen, string label, Color color, float distance)
        {
            Styles.Build();

            const float size = 9f;
            var dot = new Rect(screen.x - size * 0.5f, screen.y - size * 0.5f, size, size);
            Draw.Round(dot, color, size * 0.5f);
            Draw.Outline(new Rect(dot.x - 2f, dot.y - 2f, size + 4f, size + 4f), Theme.Fade(Color.black, 0.45f), (size + 4f) * 0.5f, 1f);

            if (string.IsNullOrEmpty(label)) return;

            string text = distance > 0f ? $"{label}  {distance:0}m" : label;
            float w = Draw.TextWidth(text, Styles.Small) + 12f;
            var box = new Rect(screen.x - w * 0.5f, screen.y + 10f, w, 18f);

            Draw.Card(box, Theme.Fade(Color.black, 0.6f), Theme.Fade(color, 0.7f), 4f);
            Draw.Label(box, text, Styles.SmallCentre, color);
        }

        /// <summary>
        /// Screen-space rectangle covering a world bounds, or false when it is off camera.
        ///
        /// Built from all eight corners: a rectangle derived from the centre point alone
        /// shrinks wrongly at oblique angles, which is why marker boxes drift off their target
        /// when you approach a machine from the side.
        /// </summary>
        public static bool ScreenBounds(Camera cam, Bounds bounds, out Rect rect)
        {
            rect = default;
            if (cam == null) return false;

            float minX = float.MaxValue, minY = float.MaxValue, maxX = float.MinValue, maxY = float.MinValue;
            bool any = false;

            for (int i = 0; i < 8; i++)
            {
                var corner = new Vector3(
                    (i & 1) == 0 ? bounds.min.x : bounds.max.x,
                    (i & 2) == 0 ? bounds.min.y : bounds.max.y,
                    (i & 4) == 0 ? bounds.min.z : bounds.max.z);

                if (!Project(cam, corner, out Vector2 s)) continue;
                any = true;
                minX = Mathf.Min(minX, s.x); maxX = Mathf.Max(maxX, s.x);
                minY = Mathf.Min(minY, s.y); maxY = Mathf.Max(maxY, s.y);
            }
            if (!any) return false;

            rect = new Rect(minX, minY, maxX - minX, maxY - minY);
            return true;
        }

        /// <summary>A full outline around a screen rect, for marking a machine you are on.</summary>
        public static void OutlineBox(Rect r, Color color, float thickness = 2f)
        {
            Draw.Fill(new Rect(r.x, r.y, r.width, thickness), color);
            Draw.Fill(new Rect(r.x, r.yMax - thickness, r.width, thickness), color);
            Draw.Fill(new Rect(r.x, r.y, thickness, r.height), color);
            Draw.Fill(new Rect(r.xMax - thickness, r.y, thickness, r.height), color);
        }

        /// <summary>
        /// A titled panel pinned above a world object.
        ///
        /// Anchored to the thing it describes rather than parked in a screen corner: a readout
        /// that is not attached to the machine it belongs to is just text, and stops being
        /// useful the moment there are two machines in view.
        /// </summary>
        public static void Plate(Rect anchor, string title, string[] rows, Color accent, bool emphasise)
        {
            Styles.Build();
            var p = Theme.P;

            float width = Draw.TextWidth(title, Styles.Strong) + 26f;
            foreach (var row in rows) width = Mathf.Max(width, Draw.TextWidth(row, Styles.Small) + 26f);
            width = Mathf.Clamp(width, 120f, 340f);

            float height = 24f + rows.Length * 16f + 8f;
            var r = new Rect(anchor.center.x - width * 0.5f, anchor.y - height - 10f, width, height);

            Draw.Shadow(r, Theme.Fade(Color.black, 0.5f), 8f, 8f, 4);
            Draw.Card(r, Theme.Fade(p.Surface, 0.94f), emphasise ? accent : Theme.Fade(accent, 0.6f), 8f,
                      emphasise ? 2f : 1f);
            Draw.Round(new Rect(r.x + 1f, r.y + 7f, 3f, r.height - 14f), accent, 1.5f);

            Draw.Label(new Rect(r.x + 12f, r.y + 5f, r.width - 20f, 16f),
                       Draw.Elide(title, Styles.Strong, r.width - 20f), Styles.Strong, p.Text);

            for (int i = 0; i < rows.Length; i++)
                Draw.Label(new Rect(r.x + 12f, r.y + 23f + i * 16f, r.width - 20f, 15f),
                           Draw.Elide(rows[i], Styles.Small, r.width - 20f), Styles.Small, p.TextMuted);

            // A stem, so which machine the plate belongs to is never ambiguous.
            Draw.Fill(new Rect(r.center.x - 1f, r.yMax, 2f, 10f), Theme.Fade(accent, 0.8f));
        }

        /// <summary>The loud one: a ring and a word, drawn on the object itself.</summary>
        public static void Callout(Rect anchor, string text, Color color, float pulse)
        {
            Styles.Build();

            float size = Mathf.Min(anchor.width, anchor.height) * 0.5f + 14f + pulse * 8f;
            var centre = anchor.center;
            var ring = new Rect(centre.x - size * 0.5f, centre.y - size * 0.5f, size, size);

            Draw.Outline(ring, Theme.Fade(color, 0.35f + pulse * 0.5f), size * 0.5f, 3f);

            float w = Draw.TextWidth(text, Styles.Strong) + 20f;
            var label = new Rect(centre.x - w * 0.5f, ring.yMax + 6f, w, 22f);
            Draw.Card(label, color, color, 5f);
            Draw.Label(label, text, Styles.SmallCentre, Theme.OnAccent);
        }

        /// <summary>A box around a world-space bounds, drawn as four edges rather than a fill
        /// so it does not obscure what it is marking.</summary>
        public static void Box(Camera cam, Bounds bounds, Color color)
        {
            if (cam == null) return;

            // Screen-align from the eight corners: a box built from the centre alone shrinks
            // wrongly at oblique angles.
            float minX = float.MaxValue, minY = float.MaxValue, maxX = float.MinValue, maxY = float.MinValue;
            bool any = false;

            for (int i = 0; i < 8; i++)
            {
                var corner = new Vector3(
                    (i & 1) == 0 ? bounds.min.x : bounds.max.x,
                    (i & 2) == 0 ? bounds.min.y : bounds.max.y,
                    (i & 4) == 0 ? bounds.min.z : bounds.max.z);

                if (!Project(cam, corner, out Vector2 s)) continue;
                any = true;
                minX = Mathf.Min(minX, s.x); maxX = Mathf.Max(maxX, s.x);
                minY = Mathf.Min(minY, s.y); maxY = Mathf.Max(maxY, s.y);
            }
            if (!any) return;

            var r = new Rect(minX, minY, maxX - minX, maxY - minY);
            const float t = 1.5f, len = 6f;

            // Corner brackets read more clearly at distance than a full outline.
            Draw.Fill(new Rect(r.x, r.y, len, t), color);
            Draw.Fill(new Rect(r.x, r.y, t, len), color);
            Draw.Fill(new Rect(r.xMax - len, r.y, len, t), color);
            Draw.Fill(new Rect(r.xMax - t, r.y, t, len), color);
            Draw.Fill(new Rect(r.x, r.yMax - t, len, t), color);
            Draw.Fill(new Rect(r.x, r.yMax - len, t, len), color);
            Draw.Fill(new Rect(r.xMax - len, r.yMax - t, len, t), color);
            Draw.Fill(new Rect(r.xMax - t, r.yMax - len, t, len), color);
        }
    }
}
