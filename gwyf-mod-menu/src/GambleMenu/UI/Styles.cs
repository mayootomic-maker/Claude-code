using UnityEngine;

namespace GambleMenu.UI
{
    /// <summary>
    /// GUIStyles, built once on the first OnGUI.
    ///
    /// They cannot be constructed earlier: GUI.skin is null outside a GUI callback, and a
    /// style made from it in Awake comes back with no font and renders nothing.
    /// </summary>
    internal static class Styles
    {
        private static bool _built;

        public static GUIStyle Body, Small, Tiny, Strong, Title, Heading, Caption;
        public static GUIStyle BodyRight, SmallRight, SmallRightBold, TinyRight, BodyCentre, SmallCentre;
        /// <summary>All-caps section label. Letter-spacing is not available in IMGUI, so the
        /// separation comes from size and weight instead.</summary>
        public static GUIStyle Kicker, KickerSmall, KickerCentre;
        public static GUIStyle Mono, MonoSmall;
        public static GUIStyle Field, Wrap, WrapSmall;

        public static void Build()
        {
            if (_built) return;
            _built = true;

            var baseFont = GUI.skin.label.font;

            Body       = Make(12, FontStyle.Normal, TextAnchor.MiddleLeft, baseFont);
            Small      = Make(11, FontStyle.Normal, TextAnchor.MiddleLeft, baseFont);
            Tiny       = Make(10, FontStyle.Normal, TextAnchor.MiddleLeft, baseFont);
            Strong     = Make(12, FontStyle.Bold,   TextAnchor.MiddleLeft, baseFont);
            Title      = Make(16, FontStyle.Bold,   TextAnchor.MiddleLeft, baseFont);
            Heading    = Make(13, FontStyle.Bold,   TextAnchor.MiddleLeft, baseFont);
            Caption    = Make(10, FontStyle.Bold,   TextAnchor.MiddleLeft, baseFont);

            Kicker      = Make(10, FontStyle.Bold,   TextAnchor.MiddleLeft, baseFont);
            KickerSmall = Make(9,  FontStyle.Bold,   TextAnchor.MiddleLeft, baseFont);
            KickerCentre = Make(9, FontStyle.Bold,   TextAnchor.MiddleCenter, baseFont);
            SmallRightBold = Make(11, FontStyle.Bold, TextAnchor.MiddleRight, baseFont);
            TinyRight   = Make(10, FontStyle.Normal, TextAnchor.MiddleRight,  baseFont);
            BodyRight   = Make(12, FontStyle.Normal, TextAnchor.MiddleRight,  baseFont);
            SmallRight  = Make(11, FontStyle.Normal, TextAnchor.MiddleRight,  baseFont);
            BodyCentre  = Make(12, FontStyle.Normal, TextAnchor.MiddleCenter, baseFont);
            SmallCentre = Make(11, FontStyle.Normal, TextAnchor.MiddleCenter, baseFont);

            // Unity ships no monospace font; the dev tools' columns are aligned by measuring
            // and padding instead, so this is only a visual nudge toward denser text.
            Mono      = Make(11, FontStyle.Normal, TextAnchor.MiddleLeft, baseFont);
            MonoSmall = Make(10, FontStyle.Normal, TextAnchor.MiddleLeft, baseFont);

            Wrap      = Make(12, FontStyle.Normal, TextAnchor.UpperLeft, baseFont);
            Wrap.wordWrap = true;
            WrapSmall = Make(11, FontStyle.Normal, TextAnchor.UpperLeft, baseFont);
            WrapSmall.wordWrap = true;

            Field = new GUIStyle(GUI.skin.textField)
            {
                fontSize = 12,
                alignment = TextAnchor.MiddleLeft,
                padding = new RectOffset(8, 8, 0, 0),
                margin = new RectOffset(0, 0, 0, 0),
                border = new RectOffset(0, 0, 0, 0),
                font = baseFont
            };
            // The default skin's textures would paint a grey 2005-era box over our own
            // rounded background, so every state is cleared to nothing and we draw it.
            Field.normal.background = null;
            Field.focused.background = null;
            Field.hover.background = null;
            Field.active.background = null;
        }

        private static GUIStyle Make(int size, FontStyle style, TextAnchor anchor, Font font)
        {
            return new GUIStyle
            {
                font = font,
                fontSize = size,
                fontStyle = style,
                alignment = anchor,
                wordWrap = false,
                clipping = TextClipping.Clip,
                richText = false,
                padding = new RectOffset(0, 0, 0, 0),
                margin = new RectOffset(0, 0, 0, 0)
            };
        }
    }
}
