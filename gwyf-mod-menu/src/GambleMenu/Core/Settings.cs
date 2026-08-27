using System.Collections.Generic;
using UnityEngine;

namespace GambleMenu.Core
{
    /// <summary>
    /// Plugin-wide settings, as opposed to the per-mod options that live on each
    /// <see cref="Mod"/>. These persist through the same <see cref="ConfigStore"/>.
    /// </summary>
    internal static class Settings
    {
        public static readonly List<Option> All = new List<Option>();

        private static T Reg<T>(T o) where T : Option { All.Add(o); return o; }

        public static readonly KeyOption MenuKey = Reg(new KeyOption(
            "menu.key", "Open menu", KeyCode.Insert,
            "The key that shows and hides this menu."));

        public static readonly KeyOption PanicKey = Reg(new KeyOption(
            "menu.panicKey", "Panic key", KeyCode.End,
            "Instantly switches every mod off and closes the menu."));

        public static readonly EnumOption Theme = Reg(new EnumOption(
            "menu.theme", "Theme", new[] { "Midnight", "Slate", "Casino", "Paper", "Contrast" }, 0,
            "Colour scheme for the menu and overlays."));

        public static readonly ColorOption Accent = Reg(new ColorOption(
            "menu.accent", "Accent colour", new Color(0.36f, 0.78f, 0.55f, 1f),
            "Used for active toggles, sliders and the selected category."));

        public static readonly FloatOption Scale = Reg(new FloatOption(
            "menu.scale", "Interface scale", 1f, 0.7f, 1.8f,
            "Scales the whole menu. Useful on 1440p and above.") { Step = 0.05f, Format = "0.00", Unit = "×" });

        public static readonly FloatOption Opacity = Reg(new FloatOption(
            "menu.opacity", "Window opacity", 0.98f, 0.5f, 1f,
            "How solid the menu background is.") { Step = 0.01f, Format = "0.00" });

        public static readonly BoolOption Animations = Reg(new BoolOption(
            "menu.animations", "Animations", true,
            "Open/close and hover transitions. Turn off if you prefer instant."));

        public static readonly BoolOption Blur = Reg(new BoolOption(
            "menu.scrim", "Dim game behind menu", true,
            "Darkens the game while the menu is open so text stays readable."));

        public static readonly BoolOption ShowToasts = Reg(new BoolOption(
            "menu.toasts", "Show notifications", true,
            "Corner messages when a mod turns on, is refused, or errors."));

        public static readonly BoolOption Watermark = Reg(new BoolOption(
            "menu.watermark", "Show watermark", false,
            "A small always-on badge with FPS and lobby role."));

        public static readonly BoolOption ReleaseCursor = Reg(new BoolOption(
            "menu.cursor", "Free the cursor with menu open", true,
            "Unlocks the mouse so you can click the menu. Restores the game's cursor state on close."));

        public static readonly BoolOption PauseWhileOpen = Reg(new BoolOption(
            "menu.pause", "Pause game while menu is open", false,
            "Sets time scale to zero. Only takes effect when you are alone in the lobby — pausing a host stalls everyone."));

        /// <summary>
        /// The single most important safety switch in the plugin.
        ///
        /// The game is server-authoritative over Mirror: writing money or quota from a client
        /// does not cheat, it desyncs — your friends' clients keep the real value and the run
        /// falls apart. On by default, and turning it off says exactly that.
        /// </summary>
        public static readonly BoolOption RespectAuthority = Reg(new BoolOption(
            "safety.authority", "Respect server authority", true,
            "Blocks host-only mods while you are a guest. Turning this off does not make them work — it makes them desync the lobby."));

        public static readonly BoolOption ConfirmDestructive = Reg(new BoolOption(
            "safety.confirm", "Confirm destructive actions", true,
            "Ask before actions that overwrite or delete a save."));

        public static readonly BoolOption AutoBackupSaves = Reg(new BoolOption(
            "safety.backup", "Back up a save before editing it", true,
            "Copies the save file next to itself before any write. Strongly recommended."));

        // Window geometry. Persisted like anything else, but hidden from the Settings page
        // (filtered by the "window." prefix) because it is set by dragging, not by typing.
        public static readonly FloatOption WinX = Reg(new FloatOption("window.x", "Window X", 120f, -8000f, 8000f));
        public static readonly FloatOption WinY = Reg(new FloatOption("window.y", "Window Y", 90f, -8000f, 8000f));
        public static readonly FloatOption WinW = Reg(new FloatOption("window.w", "Window width", 940f, 720f, 2400f));
        public static readonly FloatOption WinH = Reg(new FloatOption("window.h", "Window height", 620f, 440f, 1600f));

        public static readonly BoolOption VerboseLog = Reg(new BoolOption(
            "debug.verbose", "Verbose logging", false,
            "Writes every binding lookup and patch to the BepInEx log."));
    }
}
