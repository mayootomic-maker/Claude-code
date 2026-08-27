using GambleMenu.Core;
using UnityEngine;

namespace GambleMenu.UI
{
    /// <summary>A complete colour set. Every surface, text weight and state has a named
    /// entry so no colour is invented at a call site.</summary>
    internal sealed class Palette
    {
        public string Name;
        public Color WindowBg, Sidebar, Header, Footer;
        public Color Surface, SurfaceAlt, SurfaceHover, SurfaceSunken;
        public Color Border, BorderStrong, BorderFocus;
        public Color Text, TextMuted, TextFaint, TextInverse;
        public Color Danger, Warn, Success, Info;
        public Color Scrim, Shadow;
        /// <summary>Track colour behind a slider fill or an off switch.</summary>
        public Color Track;
        /// <summary>Background for a card whose mod is running. Distinct from SurfaceHover so
        /// an active card still reads as active while the cursor is somewhere else.</summary>
        public Color SurfaceActive;
    }

    internal static class Theme
    {
        private static readonly Palette Midnight = new Palette
        {
            Name = "Midnight", SurfaceActive = Hex("181F26"),
            WindowBg      = Hex("0D1014"), Sidebar    = Hex("0A0C10"), Header = Hex("12161D"), Footer = Hex("0A0C10"),
            Surface       = Hex("171C24"), SurfaceAlt = Hex("1E242E"), SurfaceHover = Hex("222935"), SurfaceSunken = Hex("0B0E13"),
            Border        = Hex("252D3A"), BorderStrong = Hex("38424F"), BorderFocus = Hex("4A5568"),
            Text          = Hex("E8ECF2"), TextMuted  = Hex("98A3B2"), TextFaint = Hex("5E6875"), TextInverse = Hex("0B0E13"),
            Danger        = Hex("F0616D"), Warn       = Hex("E9B44C"), Success = Hex("5BD08A"), Info = Hex("5AA9F0"),
            Scrim         = new Color(0f, 0f, 0f, 0.55f), Shadow = new Color(0f, 0f, 0f, 0.45f),
            Track         = Hex("2A3341")
        };

        private static readonly Palette Slate = new Palette
        {
            Name = "Slate", SurfaceActive = Hex("242B33"),
            WindowBg      = Hex("181A1F"), Sidebar    = Hex("141619"), Header = Hex("1D2026"), Footer = Hex("141619"),
            Surface       = Hex("22262D"), SurfaceAlt = Hex("282D35"), SurfaceHover = Hex("2F353F"), SurfaceSunken = Hex("15181C"),
            Border        = Hex("323842"), BorderStrong = Hex("434B57"), BorderFocus = Hex("5A6473"),
            Text          = Hex("EDEFF2"), TextMuted  = Hex("A7AEB9"), TextFaint = Hex("6F7783"), TextInverse = Hex("15181C"),
            Danger        = Hex("EC6A75"), Warn       = Hex("E2B15A"), Success = Hex("62C98D"), Info = Hex("64A8E8"),
            Scrim         = new Color(0f, 0f, 0f, 0.5f), Shadow = new Color(0f, 0f, 0f, 0.4f),
            Track         = Hex("353C46")
        };

        private static readonly Palette Casino = new Palette
        {
            Name = "Casino", SurfaceActive = Hex("231A1D"),
            WindowBg      = Hex("120E10"), Sidebar    = Hex("0D0A0C"), Header = Hex("181114"), Footer = Hex("0D0A0C"),
            Surface       = Hex("1E1518"), SurfaceAlt = Hex("251A1E"), SurfaceHover = Hex("2E2025"), SurfaceSunken = Hex("0F0B0D"),
            Border        = Hex("33232A"), BorderStrong = Hex("47323A"), BorderFocus = Hex("6B4650"),
            Text          = Hex("F2E9EC"), TextMuted  = Hex("B49AA3"), TextFaint = Hex("7C6670"), TextInverse = Hex("120E10"),
            Danger        = Hex("E8505F"), Warn       = Hex("D9A441"), Success = Hex("4FBF7B"), Info = Hex("5E9FD8"),
            Scrim         = new Color(0.05f, 0f, 0.02f, 0.55f), Shadow = new Color(0f, 0f, 0f, 0.5f),
            Track         = Hex("3A282F")
        };

        private static readonly Palette Paper = new Palette
        {
            Name = "Paper", SurfaceActive = Hex("F2F7F4"),
            WindowBg      = Hex("F5F6F8"), Sidebar    = Hex("ECEEF2"), Header = Hex("FFFFFF"), Footer = Hex("ECEEF2"),
            Surface       = Hex("FFFFFF"), SurfaceAlt = Hex("F7F8FA"), SurfaceHover = Hex("EEF1F5"), SurfaceSunken = Hex("E7EAEF"),
            Border        = Hex("DCE1E8"), BorderStrong = Hex("C3CAD4"), BorderFocus = Hex("9AA5B4"),
            Text          = Hex("1A1D23"), TextMuted  = Hex("5B6472"), TextFaint = Hex("8C95A3"), TextInverse = Hex("FFFFFF"),
            Danger        = Hex("D33B4A"), Warn       = Hex("B27A12"), Success = Hex("1F9D57"), Info = Hex("2A78C4"),
            Scrim         = new Color(0f, 0f, 0f, 0.35f), Shadow = new Color(0.1f, 0.12f, 0.16f, 0.18f),
            Track         = Hex("D8DDE5")
        };

        /// <summary>Maximum separation between text and background, for players who cannot
        /// read the low-contrast palettes. Not merely "dark with brighter text" — the borders
        /// and tracks are lifted too, so structure survives as well as text.</summary>
        private static readonly Palette Contrast = new Palette
        {
            Name = "Contrast", SurfaceActive = Hex("132013"),
            WindowBg      = Hex("000000"), Sidebar    = Hex("000000"), Header = Hex("0A0A0A"), Footer = Hex("000000"),
            Surface       = Hex("101010"), SurfaceAlt = Hex("181818"), SurfaceHover = Hex("242424"), SurfaceSunken = Hex("050505"),
            Border        = Hex("5A5A5A"), BorderStrong = Hex("8A8A8A"), BorderFocus = Hex("FFFFFF"),
            Text          = Hex("FFFFFF"), TextMuted  = Hex("D0D0D0"), TextFaint = Hex("A0A0A0"), TextInverse = Hex("000000"),
            Danger        = Hex("FF6B6B"), Warn       = Hex("FFD24A"), Success = Hex("57F08D"), Info = Hex("6EC1FF"),
            Scrim         = new Color(0f, 0f, 0f, 0.7f), Shadow = new Color(0f, 0f, 0f, 0.6f),
            Track         = Hex("3A3A3A")
        };

        private static readonly Palette[] Palettes = { Midnight, Slate, Casino, Paper, Contrast };

        public static Palette P
        {
            get
            {
                int i = Mathf.Clamp(Settings.Theme.Index, 0, Palettes.Length - 1);
                return Palettes[i];
            }
        }

        public static Color Accent => Settings.Accent.Value;

        /// <summary>Text that sits on top of the accent colour. Picked by luminance so a pale
        /// accent gets dark text instead of unreadable white.</summary>
        public static Color OnAccent
        {
            get
            {
                var a = Accent;
                float luminance = 0.2126f * a.r + 0.7152f * a.g + 0.0722f * a.b;
                return luminance > 0.6f ? P.TextInverse : Color.white;
            }
        }

        public static Color Fade(Color c, float alpha) => new Color(c.r, c.g, c.b, c.a * alpha);

        public static Color Mix(Color a, Color b, float t) => Color.Lerp(a, b, Mathf.Clamp01(t));

        private static Color Hex(string hex)
        {
            // Guards a typo'd literal rather than returning magenta silently at draw time.
            if (hex.Length != 6 || !int.TryParse(hex, System.Globalization.NumberStyles.HexNumber,
                                                 System.Globalization.CultureInfo.InvariantCulture, out int v))
                return new Color(1f, 0f, 1f, 1f);
            return new Color(((v >> 16) & 0xFF) / 255f, ((v >> 8) & 0xFF) / 255f, (v & 0xFF) / 255f, 1f);
        }
    }
}
