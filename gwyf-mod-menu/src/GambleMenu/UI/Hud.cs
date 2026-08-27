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

        /// <summary>Set while the screenshot mod is hiding the interface, so our own readout
        /// vanishes with the game's rather than being the one thing left on screen.</summary>
        public static bool Suppressed;

        public static void Begin() => _lines.Clear();

        /// <summary>Queues one line of readout. Safe to call from any mod's overlay pass.</summary>
        public static void Line(string text)
        {
            if (!string.IsNullOrEmpty(text)) _lines.Add(text);
        }

        public static void End()
        {
            if (_lines.Count == 0 || Suppressed) return;
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

        /// <summary>
        /// Screen-space rectangle covering a world bounds, or false when it is off camera.
        ///
        /// Built from all eight corners: a rectangle derived from the centre point alone
        /// shrinks wrongly at oblique angles, which is why naive marker boxes drift off their
        /// target when you approach from the side.
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

        /// <summary>A full outline around a screen rect. Kept for the opt-in "Box" marker
        /// style; the ring below is the default because a box belongs to the screen rather
        /// than to the room.</summary>
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
        /// Drawn for one machine at a time. Anchored to the thing it describes rather than
        /// parked in a screen corner, but a plate on every object at once is exactly the
        /// clutter the ring-and-pin style exists to avoid.
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
        }

        /// <summary>
        /// A ring on the ground around a world position, drawn in true perspective.
        ///
        /// This is the marker that does not look like a cheat overlay. A bounding box is the
        /// visual language of an ESP hack because it is drawn in screen space around whatever
        /// happens to be there — it belongs to the screen, not to the world. A circle projected
        /// through the camera lies on the floor, tilts with the view, and reads as something
        /// placed in the room.
        /// </summary>
        public static void GroundRing(Camera cam, Vector3 centre, float radius, Color colour,
                                      float thickness = 2f, int segments = 40)
        {
            if (cam == null) return;

            Vector2 previous = Vector2.zero;
            bool havePrevious = false;
            Vector2 first = Vector2.zero;
            bool haveFirst = false;

            for (int i = 0; i < segments; i++)
            {
                float angle = i / (float)segments * Mathf.PI * 2f;
                var point = centre + new Vector3(Mathf.Cos(angle) * radius, 0f, Mathf.Sin(angle) * radius);

                if (!Project(cam, point, out Vector2 s))
                {
                    // A ring straddling the camera plane has to break rather than draw a chord
                    // straight across the screen.
                    havePrevious = false;
                    continue;
                }

                if (!haveFirst) { first = s; haveFirst = true; }
                if (havePrevious) Draw.Line(previous, s, colour, thickness);
                previous = s;
                havePrevious = true;
            }

            if (havePrevious && haveFirst) Draw.Line(previous, first, colour, thickness);
        }

        /// <summary>
        /// A map-pin badge: a disc with a tail, hanging above a point.
        ///
        /// Deliberately a shape rather than a labelled rectangle. An icon and a colour carry
        /// the meaning at a glance and stop the screen turning into a wall of text boxes when
        /// several machines are in view.
        /// </summary>
        public static void Pin(Vector2 tip, char glyph, Color colour, float scale = 1f)
        {
            float r = 11f * scale;
            var centre = new Vector2(tip.x, tip.y - r - 7f * scale);

            // Tail: a triangle drawn as a stack of narrowing lines, so it tapers to the point.
            int steps = Mathf.Max(3, Mathf.RoundToInt(8f * scale));
            for (int i = 0; i < steps; i++)
            {
                float t = i / (float)steps;
                float halfWidth = Mathf.Lerp(r * 0.55f, 0.6f, t);
                float y = Mathf.Lerp(centre.y + r * 0.55f, tip.y, t);
                Draw.Line(new Vector2(centre.x - halfWidth, y), new Vector2(centre.x + halfWidth, y), colour, 1.6f);
            }

            var disc = new Rect(centre.x - r, centre.y - r, r * 2f, r * 2f);
            Draw.Round(disc, colour, r);
            Draw.Outline(new Rect(disc.x - 1.5f, disc.y - 1.5f, disc.width + 3f, disc.height + 3f),
                         Theme.Fade(Color.black, 0.35f), r + 1.5f, 1.5f);

            var inner = new Rect(disc.x + r * 0.42f, disc.y + r * 0.42f, r * 1.16f, r * 1.16f);
            var ink = Theme.OnAccentFor(colour);

            switch (glyph)
            {
                case 'w': Draw.Check(inner, ink, 2f * scale); break;
                case 'l': Draw.Cross(inner, ink, 2f * scale); break;
                default:  Draw.Dot(inner, ink, 4.5f * scale); break;
            }
        }

        /// <summary>A short caption under a pin, for the one marker the player is looking at.</summary>
        public static void PinCaption(Vector2 tip, string text, Color colour, float alpha)
        {
            if (string.IsNullOrEmpty(text) || alpha <= 0.02f) return;
            Styles.Build();

            float w = Draw.TextWidth(text, Styles.Small) + 16f;
            var r = new Rect(tip.x - w * 0.5f, tip.y + 6f, w, 19f);

            float previous = Draw.Alpha;
            Draw.Alpha = previous * alpha;
            Draw.Card(r, Theme.Fade(Color.black, 0.55f), Theme.Fade(colour, 0.5f), 5f);
            Draw.Label(r, text, Styles.SmallCentre, colour);
            Draw.Alpha = previous;
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
