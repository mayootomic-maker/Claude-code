using GambleMenu.Core;
using UnityEngine;

namespace GambleMenu.UI
{
    /// <summary>
    /// Category glyphs, drawn from lines and discs.
    ///
    /// No font is trusted for these. Unity's built-in font resolves symbols through whatever
    /// the host system offers, so a glyph that looks right on one machine is a blank box on
    /// another — and a menu whose navigation is blank boxes is unusable. Geometry always draws.
    ///
    /// They are also what stops the sidebar being a column of undifferentiated words: shape is
    /// recognised before text is read, which is the whole reason to have them.
    /// </summary>
    internal static class Icons
    {
        public static void Draw(Category cat, Rect box, Color c)
        {
            // Work on a square, so a glyph never stretches with its container.
            float size = Mathf.Min(box.width, box.height);
            var r = new Rect(box.center.x - size * 0.5f, box.center.y - size * 0.5f, size, size);

            switch (cat)
            {
                case Category.Economy:     Chip(r, c); break;
                case Category.Machines:    Reels(r, c); break;
                case Category.Timing:      Clock(r, c); break;
                case Category.Progression: Steps(r, c); break;
                case Category.Saves:       Disc(r, c); break;
                case Category.Player:      Person(r, c); break;
                case Category.Visual:      Eye(r, c); break;
                case Category.Performance: Gauge(r, c); break;
                case Category.Automation:  Loop(r, c); break;
                case Category.Session:     Link(r, c); break;
                default:                   Brackets(r, c); break;
            }
        }

        /// <summary>A casino chip: the motif the whole interface is built around.</summary>
        private static void Chip(Rect r, Color c)
        {
            float d = r.width * 0.82f;
            var disc = new Rect(r.center.x - d * 0.5f, r.center.y - d * 0.5f, d, d);
            UI.Draw.Outline(disc, c, d * 0.5f, 1.5f);

            float inner = d * 0.36f;
            var dot = new Rect(r.center.x - inner * 0.5f, r.center.y - inner * 0.5f, inner, inner);
            UI.Draw.Round(dot, c, inner * 0.5f);

            // Edge notches, at the four quarters.
            for (int i = 0; i < 4; i++)
            {
                float a = i * Mathf.PI * 0.5f + Mathf.PI * 0.25f;
                var from = r.center + new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * (d * 0.36f);
                var to = r.center + new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * (d * 0.52f);
                UI.Draw.Line(from, to, c, 1.4f);
            }
        }

        private static void Reels(Rect r, Color c)
        {
            float w = r.width * 0.26f;
            float h = r.height * 0.72f;
            float y = r.center.y - h * 0.5f;

            for (int i = 0; i < 3; i++)
            {
                float x = r.x + r.width * 0.09f + i * (w + r.width * 0.05f);
                UI.Draw.Outline(new Rect(x, y, w, h), c, 2f, 1.4f);
                float dot = w * 0.42f;
                UI.Draw.Round(new Rect(x + (w - dot) * 0.5f, r.center.y - dot * 0.5f, dot, dot), c, dot * 0.5f);
            }
        }

        private static void Clock(Rect r, Color c)
        {
            float d = r.width * 0.82f;
            var face = new Rect(r.center.x - d * 0.5f, r.center.y - d * 0.5f, d, d);
            UI.Draw.Outline(face, c, d * 0.5f, 1.5f);

            UI.Draw.Line(r.center, r.center + new Vector2(0f, -d * 0.30f), c, 1.5f);
            UI.Draw.Line(r.center, r.center + new Vector2(d * 0.24f, 0f), c, 1.5f);
        }

        private static void Steps(Rect r, Color c)
        {
            float w = r.width * 0.26f;
            for (int i = 0; i < 3; i++)
            {
                float h = r.height * (0.30f + i * 0.22f);
                float x = r.x + r.width * 0.10f + i * (w + r.width * 0.04f);
                UI.Draw.Round(new Rect(x, r.yMax - r.height * 0.14f - h, w, h), c, 1.5f);
            }
        }

        private static void Disc(Rect r, Color c)
        {
            var body = new Rect(r.x + r.width * 0.12f, r.y + r.height * 0.14f, r.width * 0.76f, r.height * 0.72f);
            UI.Draw.Outline(body, c, 2.5f, 1.4f);
            UI.Draw.Round(new Rect(body.x + body.width * 0.24f, body.y, body.width * 0.52f, body.height * 0.34f), c, 1.5f);
            UI.Draw.Line(new Vector2(body.x + body.width * 0.2f, body.yMax - body.height * 0.2f),
                         new Vector2(body.xMax - body.width * 0.2f, body.yMax - body.height * 0.2f), c, 1.4f);
        }

        private static void Person(Rect r, Color c)
        {
            float head = r.width * 0.34f;
            UI.Draw.Round(new Rect(r.center.x - head * 0.5f, r.y + r.height * 0.10f, head, head), c, head * 0.5f);

            var shoulders = new Rect(r.center.x - r.width * 0.32f, r.center.y + r.height * 0.08f,
                                     r.width * 0.64f, r.height * 0.34f);
            UI.Draw.Round(shoulders, c, shoulders.width * 0.45f);
        }

        private static void Eye(Rect r, Color c)
        {
            // Two arcs meeting at the corners, drawn as short chords.
            const int steps = 9;
            float halfWidth = r.width * 0.42f;
            float rise = r.height * 0.22f;

            for (int side = -1; side <= 1; side += 2)
            {
                Vector2 previous = Vector2.zero;
                for (int i = 0; i <= steps; i++)
                {
                    float t = i / (float)steps;
                    float x = Mathf.Lerp(-halfWidth, halfWidth, t);
                    float y = side * rise * Mathf.Sin(t * Mathf.PI);
                    var point = r.center + new Vector2(x, y);
                    if (i > 0) UI.Draw.Line(previous, point, c, 1.5f);
                    previous = point;
                }
            }

            float pupil = r.width * 0.24f;
            UI.Draw.Round(new Rect(r.center.x - pupil * 0.5f, r.center.y - pupil * 0.5f, pupil, pupil), c, pupil * 0.5f);
        }

        private static void Gauge(Rect r, Color c)
        {
            const int steps = 14;
            float radius = r.width * 0.40f;
            Vector2 previous = Vector2.zero;

            for (int i = 0; i <= steps; i++)
            {
                float a = Mathf.PI * (1f - i / (float)steps);   // left to right over the top
                var point = new Vector2(r.center.x + Mathf.Cos(a) * radius,
                                        r.center.y + r.height * 0.16f - Mathf.Sin(a) * radius);
                if (i > 0) UI.Draw.Line(previous, point, c, 1.5f);
                previous = point;
            }

            var pivot = new Vector2(r.center.x, r.center.y + r.height * 0.16f);
            UI.Draw.Line(pivot, pivot + new Vector2(radius * 0.62f, -radius * 0.58f), c, 1.6f);
        }

        private static void Loop(Rect r, Color c)
        {
            const int steps = 16;
            float radius = r.width * 0.36f;
            Vector2 previous = Vector2.zero;

            // Deliberately not a closed circle: the gap plus an arrowhead is what makes it
            // read as "repeats" rather than "a ring".
            for (int i = 0; i <= steps; i++)
            {
                float a = Mathf.Lerp(0.55f, Mathf.PI * 2f - 0.15f, i / (float)steps);
                var point = r.center + new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * radius;
                if (i > 0) UI.Draw.Line(previous, point, c, 1.5f);
                previous = point;
            }

            var head = r.center + new Vector2(Mathf.Cos(0.55f), Mathf.Sin(0.55f)) * radius;
            UI.Draw.Line(head, head + new Vector2(-radius * 0.34f, -radius * 0.12f), c, 1.5f);
            UI.Draw.Line(head, head + new Vector2(-radius * 0.05f, -radius * 0.38f), c, 1.5f);
        }

        private static void Link(Rect r, Color c)
        {
            float d = r.width * 0.30f;
            var a = new Vector2(r.x + r.width * 0.26f, r.y + r.height * 0.30f);
            var b = new Vector2(r.xMax - r.width * 0.26f, r.yMax - r.height * 0.30f);

            UI.Draw.Line(a, b, c, 1.4f);
            UI.Draw.Round(new Rect(a.x - d * 0.5f, a.y - d * 0.5f, d, d), c, d * 0.5f);
            UI.Draw.Outline(new Rect(b.x - d * 0.5f, b.y - d * 0.5f, d, d), c, d * 0.5f, 1.5f);
        }

        private static void Brackets(Rect r, Color c)
        {
            float w = r.width * 0.22f;
            float h = r.height * 0.30f;

            var left = new Vector2(r.x + r.width * 0.30f, r.center.y);
            UI.Draw.Line(left + new Vector2(w, -h), left, c, 1.5f);
            UI.Draw.Line(left, left + new Vector2(w, h), c, 1.5f);

            var right = new Vector2(r.xMax - r.width * 0.30f, r.center.y);
            UI.Draw.Line(right + new Vector2(-w, -h), right, c, 1.5f);
            UI.Draw.Line(right, right + new Vector2(-w, h), c, 1.5f);
        }
    }
}
