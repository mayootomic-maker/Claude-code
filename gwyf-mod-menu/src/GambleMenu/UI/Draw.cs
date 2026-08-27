using UnityEngine;

namespace GambleMenu.UI
{
    /// <summary>
    /// Low-level shapes and text for the menu.
    ///
    /// Borders are drawn as an outer rounded rect with an inset rounded rect on top rather
    /// than through DrawTexture's borderWidths argument: that argument's colour semantics
    /// differ between Unity versions, and a border that silently fills the whole card on the
    /// player's build is not worth saving one draw call.
    ///
    /// No image assets ship with the plugin. Every icon here is geometry, so nothing depends
    /// on a glyph existing in whatever font the game happens to load.
    /// </summary>
    internal static class Draw
    {
        private static Texture2D _white;

        /// <summary>
        /// Opacity applied to everything drawn here, for fading a whole panel in or out.
        ///
        /// It cannot be done with GUI.color: the DrawTexture overload that gives us rounded
        /// corners takes an explicit colour argument and ignores GUI.color entirely, so a
        /// fade driven that way animates the text and leaves every surface at full opacity.
        /// </summary>
        public static float Alpha = 1f;

        private static Color A(Color c) => Alpha >= 0.999f ? c : new Color(c.r, c.g, c.b, c.a * Alpha);

        public static Texture2D White
        {
            get
            {
                if (_white != null) return _white;
                _white = new Texture2D(1, 1, TextureFormat.RGBA32, false) { hideFlags = HideFlags.HideAndDontSave };
                _white.SetPixel(0, 0, Color.white);
                _white.Apply();
                return _white;
            }
        }

        // --- rectangles -------------------------------------------------------------

        private static void Raw(Rect r, Color c)
        {
            var prev = GUI.color;
            GUI.color = c;
            GUI.DrawTexture(r, White);
            GUI.color = prev;
        }

        public static void Fill(Rect r, Color c)
        {
            c = A(c);
            if (c.a <= 0f) return;
            Raw(r, c);
        }

        public static void Round(Rect r, Color c, float radius)
        {
            c = A(c);
            if (c.a <= 0f) return;
            if (radius <= 0.5f) { Raw(r, c); return; }
            radius = Mathf.Min(radius, Mathf.Min(r.width, r.height) * 0.5f);
            GUI.DrawTexture(r, White, ScaleMode.StretchToFill, true, 0f, c, Vector4.zero, new Vector4(radius, radius, radius, radius));
        }

        /// <summary>Filled rounded rect with a crisp border of <paramref name="width"/> px.</summary>
        public static void Card(Rect r, Color fill, Color border, float radius, float width = 1f)
        {
            if (width > 0f && border.a > 0f)
            {
                Round(r, border, radius);
                var inner = new Rect(r.x + width, r.y + width, r.width - width * 2f, r.height - width * 2f);
                if (inner.width > 0f && inner.height > 0f)
                    Round(inner, fill, Mathf.Max(0f, radius - width));
            }
            else
            {
                Round(r, fill, radius);
            }
        }

        /// <summary>
        /// A ring with nothing inside it, for focus rings, the magnifier and the crosshair.
        ///
        /// This is the one place that uses DrawTexture's borderWidths argument, because an
        /// outline is precisely what it draws. Card() deliberately does not: there, stacking
        /// two filled rects gives the same result with no dependence on how a given Unity
        /// version interprets the border colour.
        /// </summary>
        public static void Outline(Rect r, Color color, float radius, float width = 1f)
        {
            color = A(color);
            if (color.a <= 0f || r.width <= 0f || r.height <= 0f) return;
            radius = Mathf.Min(radius, Mathf.Min(r.width, r.height) * 0.5f);
            GUI.DrawTexture(r, White, ScaleMode.StretchToFill, true, 0f, color,
                            new Vector4(width, width, width, width),
                            new Vector4(radius, radius, radius, radius));
        }

        /// <summary>
        /// A soft drop shadow, approximated by stacked translucent rounded rects.
        ///
        /// IMGUI has no blur, so the falloff is faked with concentric layers whose alpha
        /// decays quadratically — enough to lift the window off the game behind it without
        /// reading as a hard outline.
        /// </summary>
        public static void Shadow(Rect r, Color color, float radius, float spread = 14f, int layers = 6)
        {
            if (color.a <= 0f) return;
            for (int i = layers; i >= 1; i--)
            {
                float t = i / (float)layers;
                float grow = spread * t;
                float alpha = color.a * (1f - t) * (1f - t) * 0.9f;
                var lr = new Rect(r.x - grow, r.y - grow + grow * 0.35f, r.width + grow * 2f, r.height + grow * 2f);
                Round(lr, new Color(color.r, color.g, color.b, alpha), radius + grow);
            }
        }

        /// <summary>
        /// A line between two screen points, at any angle.
        ///
        /// The primitive IMGUI lacks and the one everything shaped rather than boxy needs:
        /// with it, a circle in world space can be projected and stroked as a real ellipse
        /// instead of being approximated by an axis-aligned rectangle.
        /// </summary>
        public static void Line(Vector2 a, Vector2 b, Color c, float thickness = 1.5f)
        {
            c = A(c);
            if (c.a <= 0f) return;

            Vector2 delta = b - a;
            float length = delta.magnitude;
            if (length < 0.01f) return;

            float angle = Mathf.Atan2(delta.y, delta.x) * Mathf.Rad2Deg;
            var matrix = GUI.matrix;
            GUIUtility.RotateAroundPivot(angle, a);
            // Drawn from the pivot outward, so rotation about `a` puts it exactly on the line.
            Raw(new Rect(a.x, a.y - thickness * 0.5f, length, thickness), c);
            GUI.matrix = matrix;
        }

        public static void VLine(float x, float y, float height, Color c, float width = 1f) => Fill(new Rect(x, y, width, height), c);
        public static void HLine(float x, float y, float length, Color c, float height = 1f) => Fill(new Rect(x, y, length, height), c);

        // --- icons ------------------------------------------------------------------

        /// <summary>A thin bar, optionally rotated about its own centre. The building block
        /// for every glyph below.</summary>
        private static void Bar(Rect r, Color c, float angle, float radius = 1f)
        {
            var pivot = new Vector2(r.x + r.width * 0.5f, r.y + r.height * 0.5f);
            var matrix = GUI.matrix;
            if (!Mathf.Approximately(angle, 0f)) GUIUtility.RotateAroundPivot(angle, pivot);
            Round(r, c, radius);
            GUI.matrix = matrix;
        }

        /// <summary>Chevron pointing down (0°), right (-90°), left (90°) or up (180°).</summary>
        public static void Chevron(Rect box, Color c, float angle, float thickness = 1.6f)
        {
            float size = Mathf.Min(box.width, box.height) * 0.42f;
            var centre = new Vector2(box.x + box.width * 0.5f, box.y + box.height * 0.5f);
            var matrix = GUI.matrix;
            GUIUtility.RotateAroundPivot(angle, centre);

            float half = size * 0.72f;
            Bar(new Rect(centre.x - half, centre.y - thickness * 0.5f, half + thickness * 0.5f, thickness), c, 45f, thickness * 0.5f);
            Bar(new Rect(centre.x - thickness * 0.5f, centre.y - thickness * 0.5f, half + thickness * 0.5f, thickness), c, -45f, thickness * 0.5f);

            GUI.matrix = matrix;
        }

        public static void Check(Rect box, Color c, float thickness = 2f)
        {
            var centre = new Vector2(box.x + box.width * 0.5f, box.y + box.height * 0.52f);
            float s = Mathf.Min(box.width, box.height) * 0.5f;
            Bar(new Rect(centre.x - s * 0.62f, centre.y + s * 0.06f, s * 0.55f, thickness), c, 45f, thickness * 0.5f);
            Bar(new Rect(centre.x - s * 0.18f, centre.y - s * 0.1f, s * 0.95f, thickness), c, -45f, thickness * 0.5f);
        }

        public static void Cross(Rect box, Color c, float thickness = 1.8f)
        {
            var centre = new Vector2(box.x + box.width * 0.5f, box.y + box.height * 0.5f);
            float len = Mathf.Min(box.width, box.height) * 0.62f;
            Bar(new Rect(centre.x - len * 0.5f, centre.y - thickness * 0.5f, len, thickness), c, 45f, thickness * 0.5f);
            Bar(new Rect(centre.x - len * 0.5f, centre.y - thickness * 0.5f, len, thickness), c, -45f, thickness * 0.5f);
        }

        public static void Dot(Rect box, Color c, float diameter = 6f)
        {
            var r = new Rect(box.x + (box.width - diameter) * 0.5f, box.y + (box.height - diameter) * 0.5f, diameter, diameter);
            Round(r, c, diameter * 0.5f);
        }

        /// <summary>A padlock, used to mark a mod the current lobby role may not run.</summary>
        public static void Lock(Rect box, Color c)
        {
            float w = Mathf.Min(box.width, box.height) * 0.6f;
            float h = w * 0.8f;
            var body = new Rect(box.x + (box.width - w) * 0.5f, box.y + box.height * 0.5f - h * 0.22f, w, h);
            Round(body, c, 1.5f);

            // Three bars make the shackle: two uprights and a cap. Drawn rather than masked,
            // because "paint transparent over it" removes nothing in immediate mode.
            const float t = 1.5f;
            float sw = w * 0.58f;
            float sh = h * 0.62f;
            float sx = body.x + (w - sw) * 0.5f;
            float sy = body.y - sh;

            Round(new Rect(sx, sy + t, t, sh - t), c, t * 0.5f);
            Round(new Rect(sx + sw - t, sy + t, t, sh - t), c, t * 0.5f);
            Round(new Rect(sx, sy, sw, t), c, t * 0.5f);
        }

        /// <summary>An exclamation mark in a rounded square — the warning glyph.</summary>
        public static void Bang(Rect box, Color c)
        {
            float w = Mathf.Max(2f, Mathf.Min(box.width, box.height) * 0.16f);
            float h = Mathf.Min(box.width, box.height) * 0.42f;
            var centre = new Vector2(box.x + box.width * 0.5f, box.y + box.height * 0.5f);
            Round(new Rect(centre.x - w * 0.5f, centre.y - h * 0.62f, w, h * 0.78f), c, w * 0.5f);
            Round(new Rect(centre.x - w * 0.5f, centre.y + h * 0.42f, w, w), c, w * 0.5f);
        }

        // --- text -------------------------------------------------------------------

        public static void Label(Rect r, string text, GUIStyle style, Color color)
        {
            color = A(color);
            var prev = style.normal.textColor;
            style.normal.textColor = color;
            GUI.Label(r, text, style);
            style.normal.textColor = prev;
        }

        public static float TextWidth(string text, GUIStyle style) => style.CalcSize(new GUIContent(text ?? string.Empty)).x;

        /// <summary>Shortens text with an ellipsis so a long mod name cannot overrun its card.</summary>
        public static string Elide(string text, GUIStyle style, float maxWidth)
        {
            if (string.IsNullOrEmpty(text)) return string.Empty;
            if (TextWidth(text, style) <= maxWidth) return text;

            const string ellipsis = "…";
            int lo = 0, hi = text.Length;
            while (lo < hi)
            {
                int mid = (lo + hi + 1) / 2;
                if (TextWidth(text.Substring(0, mid) + ellipsis, style) <= maxWidth) lo = mid;
                else hi = mid - 1;
            }
            return lo <= 0 ? ellipsis : text.Substring(0, lo) + ellipsis;
        }
    }
}
