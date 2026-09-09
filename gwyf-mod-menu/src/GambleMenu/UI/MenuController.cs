using System.Collections.Generic;
using System.Globalization;
using GambleMenu.Core;
using UnityEngine;

namespace GambleMenu.UI
{
    /// <summary>
    /// The menu window: chrome, layout, input and the per-frame pump that drives every mod.
    ///
    /// Everything is drawn in logical pixels and scaled once through GUI.matrix, so the
    /// interface-scale setting changes size without any call site doing arithmetic — and
    /// mouse coordinates come back through the same matrix, so hit-testing stays correct.
    /// </summary>
    internal sealed class MenuController : MonoBehaviour
    {
        public static MenuController Instance { get; private set; }

        private const float HeaderH = 50f;
        private const float FooterH = 28f;
        private const float SidebarW = 192f;
        private const float Radius = 12f;

        private bool _open;
        private string _search = "";
        private int _page;
        private bool _dragging, _resizing;
        private Vector2 _dragOffset;

        private readonly Dictionary<int, float> _scroll = new Dictionary<int, float>();
        private readonly HashSet<string> _expanded = new HashSet<string>();
        private readonly Pages _pages = new Pages();

        // Cursor state captured on open and put back on close, so a game that hides the
        // cursor during play does not end up with it stuck visible afterwards.
        /// <summary>Frame of the last toggle, so the OnGUI and Update paths below cannot both
        /// fire for one keypress and cancel each other out.</summary>
        private int _lastToggleFrame = -1;

        /// <summary>When the plugin finished loading, for the startup banner.</summary>
        private float _loadedAt;

        private CursorLockMode _prevLock;
        private bool _prevVisible;
        private float _prevTimeScale = 1f;
        private bool _pausedByUs;

        public bool IsOpen => _open;

        /// <summary>Whether the menu is showing, readable without holding a reference. Mods
        /// use it to keep automation from firing into the game while it is being configured.</summary>
        public static bool IsOpenNow => Instance != null && Instance._open;
        public IReadOnlyCollection<string> Expanded => _expanded;

        private void Awake()
        {
            Instance = this;
            _loadedAt = Time.unscaledTime;
            _prevLock = Cursor.lockState;
            _prevVisible = Cursor.visible;
        }

        private void OnDestroy()
        {
            if (_pausedByUs) Time.timeScale = _prevTimeScale;
            if (Instance == this) Instance = null;
        }

        // --- frame pump -------------------------------------------------------------

        private void Update()
        {
            Notifier.Prune();

            // A rebind in progress swallows all keys, or binding "Insert" would immediately
            // toggle the menu you are standing in.
            if (!Widgets.IsCapturingKey)
            {
                // Secondary path. The primary one lives in OnGUI and does not depend on any
                // input backend at all; this only adds held-key support and costs nothing
                // when OnGUI already handled the press this frame.
                if (InputBridge.GetKeyDown(Settings.MenuKey.Value) ||
                    InputBridge.GetKeyDown(Settings.MenuKeyAlt.Value)) RequestToggle();
                if (InputBridge.GetKeyDown(Settings.PanicKey.Value)) Panic();
                ModRegistry.PollHotkeys();
            }

            ModRegistry.Tick();
            ApplyCursor();
            ApplyPause();
        }

        private void LateUpdate() => ModRegistry.TickLate();

        public void Toggle() => SetOpen(!_open);

        /// <summary>
        /// Toggles at most once per frame.
        ///
        /// Two independent paths watch for the menu key — IMGUI events and the input backend
        /// — precisely so that one failing does not lock the user out. On a game where both
        /// work, an unguarded toggle would fire twice and the menu would never appear to open.
        /// </summary>
        private void RequestToggle()
        {
            if (_lastToggleFrame == Time.frameCount) return;
            _lastToggleFrame = Time.frameCount;
            Toggle();
        }

        public void SetOpen(bool open)
        {
            if (_open == open) return;
            _open = open;

            if (open)
            {
                _prevLock = Cursor.lockState;
                _prevVisible = Cursor.visible;
                if (!Settings.EverOpened.Value)
                {
                    // Records that a way in was found, which retires the on-screen tab.
                    Settings.EverOpened.Value = true;
                    ConfigStore.SaveActive();
                }
            }
            else
            {
                Widgets.CloseDropdown();
                Widgets.CancelCapture();
                GUIUtility.keyboardControl = 0;
                RestoreCursor();
                ConfigStore.SaveActive();
            }
        }

        private void Panic()
        {
            ModRegistry.DisableAll();
            SetOpen(false);
        }

        /// <summary>
        /// Holds the cursor free while the menu is open.
        ///
        /// Re-applied every frame rather than once on open: the game's own controller sets
        /// the lock state in its Update, so a single assignment is overwritten within a frame
        /// and the menu becomes unclickable.
        /// </summary>
        private void ApplyCursor()
        {
            if (!_open || !Settings.ReleaseCursor.Value) return;
            if (Cursor.lockState != CursorLockMode.None) Cursor.lockState = CursorLockMode.None;
            if (!Cursor.visible) Cursor.visible = true;
        }

        private void RestoreCursor()
        {
            if (!Settings.ReleaseCursor.Value) return;
            Cursor.lockState = _prevLock;
            Cursor.visible = _prevVisible;
        }

        /// <summary>
        /// Zeroes time scale while the menu is open, but only when alone.
        ///
        /// On a host, time scale is the simulation everyone else is waiting on — pausing it
        /// freezes the whole lobby, which is why this refuses rather than doing it quietly.
        /// </summary>
        private void ApplyPause()
        {
            bool want = _open && Settings.PauseWhileOpen.Value && GameBridge.PlayerCount <= 1;

            if (want && !_pausedByUs)
            {
                _prevTimeScale = Time.timeScale;
                Time.timeScale = 0f;
                _pausedByUs = true;
            }
            else if (!want && _pausedByUs)
            {
                Time.timeScale = _prevTimeScale;
                _pausedByUs = false;
            }
        }

        // --- drawing ----------------------------------------------------------------

        private void OnGUI()
        {
            HandleMenuKeyEvent();

            Styles.Build();
            Anim.BeginFrame();
            Widgets.BeginFrame();

            float scale = Settings.Scale.Value;
            var matrix = GUI.matrix;

            // Mod overlays draw unscaled: an ESP box must land on the world position, not on
            // a menu-scaled version of it.
            GUI.depth = 1;
            Hud.Begin();
            ModRegistry.DrawOverlays();
            Hud.End();

            GUI.depth = 0;
            GUIUtility.ScaleAroundPivot(Vector2.one * scale, Vector2.zero);
            float logicalW = Screen.width / scale;
            float logicalH = Screen.height / scale;

            float openAnim = Anim.To("menu.open", _open ? 1f : 0f, 15f);
            if (openAnim > 0.002f) DrawWindow(openAnim, logicalW, logicalH);

            DrawStartupBanner(logicalW, logicalH);
            DrawOpenHandle(logicalW, logicalH);
            if (Settings.Watermark.Value && !_open) DrawWatermark(logicalW);
            if (Settings.ShowToasts.Value) DrawToasts(logicalW, logicalH);

            Widgets.FlushOverlays();
            GUI.matrix = matrix;
        }

        private void DrawWindow(float t, float logicalW, float logicalH)
        {
            var p = Theme.P;

            if (Settings.Blur.Value)
                Draw.Fill(new Rect(0, 0, logicalW, logicalH), Theme.Fade(p.Scrim, t));

            var win = ClampWindow(logicalW, logicalH);

            // Grow into place: a small scale-up reads as the window arriving rather than
            // blinking on, and costs one matrix push.
            if (t < 0.999f)
            {
                float s = Mathf.Lerp(0.965f, 1f, Anim.EaseOutCubic(t));
                GUIUtility.ScaleAroundPivot(Vector2.one * s, win.center);
            }

            float alpha = Mathf.Clamp01(t * 1.3f) * Settings.Opacity.Value;
            Draw.Alpha = alpha;

            Draw.Shadow(win, p.Shadow, Radius, 22f, 7);
            Draw.Card(win, p.WindowBg, p.BorderStrong, Radius);

            var header  = new Rect(win.x, win.y, win.width, HeaderH);
            var sidebar = new Rect(win.x, header.yMax, SidebarW, win.height - HeaderH - FooterH);
            var content = new Rect(sidebar.xMax, header.yMax, win.width - SidebarW, win.height - HeaderH - FooterH);
            var footer  = new Rect(win.x, content.yMax, win.width, FooterH);

            DrawHeader(header);
            DrawSidebar(sidebar);
            DrawContent(content);
            DrawFooter(footer);
            DrawResizeGrip(win);

            // The tooltip is drawn at full opacity: a hint that fades with the window it is
            // explaining is unreadable exactly when it is needed.
            Draw.Alpha = 1f;
            DrawTooltip(win);

            HandleWindowDrag(header, win, logicalW, logicalH);
        }

        private Rect ClampWindow(float logicalW, float logicalH)
        {
            float w = Mathf.Clamp(Settings.WinW.Value, 720f, Mathf.Max(720f, logicalW));
            float h = Mathf.Clamp(Settings.WinH.Value, 440f, Mathf.Max(440f, logicalH));
            // Keep at least a strip of the header on screen; a window dragged off the edge
            // and saved there would otherwise be unrecoverable without editing the config.
            float x = Mathf.Clamp(Settings.WinX.Value, -w + 120f, logicalW - 120f);
            float y = Mathf.Clamp(Settings.WinY.Value, 0f, Mathf.Max(0f, logicalH - HeaderH));
            return new Rect(x, y, w, h);
        }

        private void DrawHeader(Rect r)
        {
            var p = Theme.P;
            Draw.Round(new Rect(r.x, r.y, r.width, r.height + Radius), p.Header, Radius);
            Draw.HLine(r.x, r.yMax - 1f, r.width, p.Border);

            var mark = new Rect(r.x + 17f, r.y + (r.height - 9f) * 0.5f, 9f, 9f);
            Draw.Round(mark, Theme.Accent, 2.5f);

            Draw.Label(new Rect(mark.xMax + 8f, r.y, 150f, r.height), "GambleMenu", Styles.Title, p.Text);

            float titleW = Draw.TextWidth("GambleMenu", Styles.Title) + 34f;
            Draw.Label(new Rect(r.x + titleW, r.y, 46f, r.height), Plugin.Version, Styles.Tiny, p.TextFaint);

            var close = new Rect(r.xMax - 42f, r.y + (r.height - 28f) * 0.5f, 28f, 28f);
            if (Widgets.Button(close, "", ButtonKind.Ghost, true, "Close (or press the menu key)", "menu.close")) SetOpen(false);
            Draw.Cross(close, p.TextMuted, 1.6f);

            Draw.Label(new Rect(r.xMax - 92f, r.y, 36f, r.height),
                       Settings.MenuKey.Value.ToString().ToUpperInvariant(), Styles.TinyRight, Theme.Fade(p.TextFaint, 0.8f));

            var search = new Rect(r.xMax - 398f, r.y + (r.height - 28f) * 0.5f, 300f, 28f);
            _search = Widgets.SearchBox(search, _search, ModRegistry.All.Count);

            DrawHeaderChips(new Rect(r.x + titleW + 54f, r.y, search.x - (r.x + titleW + 54f) - 12f, r.height));
        }

        /// <summary>
        /// Live run values in the header.
        ///
        /// The numbers most of this menu exists to change were previously invisible while
        /// changing them — you set a balance, closed the menu to look, and reopened it. They
        /// are only drawn when the game actually exposes them, so in another game the space is
        /// simply empty rather than showing zeroes.
        /// </summary>
        private void DrawHeaderChips(Rect area)
        {
            if (area.width < 160f) return;
            var p = Theme.P;

            long? money = RunState.Money;
            long? quota = RunState.Quota;
            if (!money.HasValue && !quota.HasValue) return;

            float x = area.x;

            if (money.HasValue)
            {
                string text = Widgets.Compact(money.Value);
                float w = Draw.TextWidth(text, Styles.Strong) + 46f;
                var chip = new Rect(x, area.y + (area.height - 24f) * 0.5f, w, 24f);
                Draw.Card(chip, p.SurfaceSunken, p.Border, 6f);
                Draw.Round(new Rect(chip.x + 9f, chip.y + 9f, 6f, 6f), Theme.Accent, 3f);
                Draw.Label(new Rect(chip.x + 21f, chip.y, 26f, chip.height), "bank", Styles.Tiny, p.TextFaint);
                Draw.Label(new Rect(chip.x + 21f, chip.y, chip.width - 30f, chip.height), text, Styles.SmallRightBold, p.Text);
                Widgets.SetTooltip(chip, money.Value.ToString("N0", CultureInfo.InvariantCulture));
                x += w + 8f;
            }

            if (quota.HasValue && x + 120f < area.xMax)
            {
                string text = Widgets.Compact(quota.Value);
                float w = Draw.TextWidth(text, Styles.Strong) + 48f;
                var chip = new Rect(x, area.y + (area.height - 24f) * 0.5f, w, 24f);
                bool covered = money.HasValue && money.Value >= quota.Value;

                Draw.Card(chip, p.SurfaceSunken, p.Border, 6f);
                Draw.Round(new Rect(chip.x + 9f, chip.y + 9f, 6f, 6f), covered ? p.Success : p.Warn, 3f);
                Draw.Label(new Rect(chip.x + 21f, chip.y, 30f, chip.height), "quota", Styles.Tiny, p.TextFaint);
                Draw.Label(new Rect(chip.x + 21f, chip.y, chip.width - 30f, chip.height), text, Styles.SmallRightBold,
                           covered ? p.Success : p.Text);
                Widgets.SetTooltip(chip, covered ? "The bank covers today's quota." : "Still short of today's quota.");
            }
        }

        private void DrawSidebar(Rect r)
        {
            var p = Theme.P;
            Draw.Fill(r, p.Sidebar);
            Draw.VLine(r.xMax - 1f, r.y, r.height, p.Border);

            var entries = _pages.SidebarEntries();
            float y = r.y + 8f;
            bool kickerDrawn = false;

            for (int i = 0; i < entries.Count; i++)
            {
                var entry = entries[i];

                if (!kickerDrawn)
                {
                    Draw.Label(new Rect(r.x + 18f, y, r.width - 26f, 14f), "MODS", Styles.Kicker, Theme.Fade(p.TextFaint, 0.75f));
                    y += 18f;
                    kickerDrawn = true;
                }

                if (entry.IsSeparator)
                {
                    Draw.HLine(r.x + 18f, y + 8f, r.width - 36f, Theme.Fade(p.Border, 0.9f));
                    y += 17f;
                    Draw.Label(new Rect(r.x + 18f, y, r.width - 26f, 14f), "SETUP", Styles.Kicker, Theme.Fade(p.TextFaint, 0.75f));
                    y += 18f;
                    continue;
                }

                var row = new Rect(r.x + 7f, y, r.width - 14f, 29f);
                bool selected = _page == i;
                bool hover = row.Contains(Event.current.mousePosition);
                float sel = Anim.To($"side.{i}.sel", selected ? 1f : 0f, 18f);
                float hl = Anim.To($"side.{i}.h", hover && !selected ? 1f : 0f, 18f);

                if (sel > 0f) Draw.Round(row, Theme.Fade(Theme.Accent, 0.12f * sel), 6f);
                else if (hl > 0f) Draw.Round(row, Theme.Fade(p.SurfaceHover, hl), 6f);

                // A disc rather than a bar, echoing the pin heads used in the world.
                if (sel > 0f)
                {
                    float d = 5f * sel;
                    Draw.Round(new Rect(row.x + 2f, row.center.y - d * 0.5f, d, d), Theme.Fade(Theme.Accent, sel), d * 0.5f);
                }

                // The icon carries the row before the word does — shape is recognised faster
                // than text, which is the entire reason a nav list has icons at all.
                var iconColour = selected ? Theme.Accent : Color.Lerp(Theme.Fade(p.TextFaint, 0.9f), p.TextMuted, hl);
                if (entry.Kind == PageKind.Category)
                    Icons.Draw(entry.Cat, new Rect(row.x + 11f, row.y + 7f, 15f, 15f), iconColour);
                else
                    Draw.Round(new Rect(row.x + 16f, row.y + 12f, 5f, 5f), iconColour, 2.5f);

                var label = new Rect(row.x + 34f, row.y, row.width - 76f, row.height);
                Draw.Label(label, Draw.Elide(entry.Title, selected ? Styles.Strong : Styles.Body, label.width),
                           selected ? Styles.Strong : Styles.Body,
                           selected ? p.Text : Color.Lerp(p.TextMuted, p.Text, hl));

                if (entry.Count > 0)
                {
                    // Plain text, not a pill: this is metadata about the row, and a bordered
                    // chip gave it more weight than the label it belongs to.
                    bool anyOn = entry.ActiveCount > 0;
                    var count = new Rect(row.xMax - 46f, row.y, 34f, row.height);
                    Draw.Label(count,
                               anyOn ? $"{entry.ActiveCount}/{entry.Count}" : entry.Count.ToString(CultureInfo.InvariantCulture),
                               anyOn ? Styles.SmallRightBold : Styles.SmallRight,
                               anyOn ? Theme.Accent : Theme.Fade(p.TextFaint, 0.85f));
                }

                if (Event.current.type == EventType.MouseDown && Event.current.button == 0 && row.Contains(Event.current.mousePosition))
                {
                    _page = i;
                    Widgets.CloseDropdown();
                    Event.current.Use();
                }

                y += 31f;
            }
        }

        private void DrawContent(Rect r)
        {
            var p = Theme.P;
            Draw.Fill(r, p.WindowBg);

            var inner = new Rect(r.x + 15f, r.y + 12f, r.width - 30f, r.height - 22f);
            // Search results scroll independently of the page underneath them.
            int scrollKey = string.IsNullOrEmpty(_search) ? _page : -1;
            float scroll = _scroll.TryGetValue(scrollKey, out float s) ? s : 0f;

            // A search spans the whole menu, so it replaces the category page rather than
            // filtering inside it.
            bool searching = !string.IsNullOrEmpty(_search);
            float contentH = searching
                ? _pages.DrawSearch(inner, scroll, _search, this)
                : _pages.DrawPage(_page, inner, scroll, _search, this);

            // Wheel handling happens after the draw because the page reports its own height,
            // and clamping to a stale height makes the last row unreachable on the frame a
            // filter changes.
            float maxScroll = Mathf.Max(0f, contentH - inner.height);
            var e = Event.current;
            if (e.type == EventType.ScrollWheel && r.Contains(e.mousePosition))
            {
                scroll += e.delta.y * 22f;
                e.Use();
            }
            scroll = Mathf.Clamp(scroll, 0f, maxScroll);
            _scroll[scrollKey] = scroll;

            if (maxScroll > 0f) DrawScrollbar(new Rect(r.xMax - 9f, r.y + 8f, 4f, r.height - 16f), scroll, maxScroll, inner.height, contentH);
        }

        private void DrawScrollbar(Rect track, float scroll, float maxScroll, float viewH, float contentH)
        {
            var p = Theme.P;
            Draw.Round(track, Theme.Fade(p.Track, 0.5f), 2f);

            float thumbH = Mathf.Max(28f, track.height * (viewH / contentH));
            float thumbY = track.y + (track.height - thumbH) * (scroll / maxScroll);
            var thumb = new Rect(track.x, thumbY, track.width, thumbH);

            bool hover = thumb.Contains(Event.current.mousePosition);
            Draw.Round(thumb, hover ? p.BorderStrong : p.Border, 2f);
        }

        private void DrawFooter(Rect r)
        {
            var p = Theme.P;
            Draw.Round(new Rect(r.x, r.y - Radius, r.width, r.height + Radius), p.Footer, Radius);
            Draw.HLine(r.x, r.y, r.width, p.Border);

            string role = GameBridge.IsConnected
                ? (GameBridge.IsHost ? $"host · {GameBridge.PlayerCount} player(s)" : "client")
                : "not in a lobby";

            int okBindings = 0;
            foreach (var b in GameBridge.All) if (b.Ok) okBindings++;

            string left = $"{role}   ·   {okBindings}/{GameBridge.All.Count} bindings   ·   {ModRegistry.EnabledCount} mod(s) on";
            Draw.Label(new Rect(r.x + 18f, r.y, r.width - 200f, r.height), left, Styles.Small, p.TextMuted);

            var dot = new Rect(r.xMax - 128f, r.y, 10f, r.height);
            Draw.Dot(dot, GameBridge.IsHost ? p.Success : (GameBridge.IsConnected ? p.Warn : p.TextFaint), 6f);

            string fps = (1f / Mathf.Max(0.0001f, Time.unscaledDeltaTime)).ToString("0", CultureInfo.InvariantCulture) + " fps";
            Draw.Label(new Rect(r.xMax - 116f, r.y, 98f, r.height), fps, Styles.SmallRight, p.TextFaint);
        }

        private void DrawResizeGrip(Rect win)
        {
            var grip = new Rect(win.xMax - 16f, win.yMax - 16f, 14f, 14f);
            var p = Theme.P;
            for (int i = 0; i < 3; i++)
                Draw.Round(new Rect(grip.x + 4f + i * 4f, grip.yMax - 4f - i * 4f, 3f, 3f), p.TextFaint, 1.5f);

            var e = Event.current;
            if (e.type == EventType.MouseDown && e.button == 0 && grip.Contains(e.mousePosition))
            {
                _resizing = true;
                e.Use();
            }
            if (_resizing && e.type == EventType.MouseDrag)
            {
                Settings.WinW.Value = e.mousePosition.x - win.x + 8f;
                Settings.WinH.Value = e.mousePosition.y - win.y + 8f;
                e.Use();
            }
            if (e.type == EventType.MouseUp) _resizing = false;
        }

        private void HandleWindowDrag(Rect header, Rect win, float logicalW, float logicalH)
        {
            var e = Event.current;
            // The right half of the header holds the search box and close button, so only the
            // left portion is a drag handle.
            var handle = new Rect(header.x, header.y, header.width - 320f, header.height);

            if (e.type == EventType.MouseDown && e.button == 0 && handle.Contains(e.mousePosition) && !_resizing)
            {
                _dragging = true;
                _dragOffset = e.mousePosition - new Vector2(win.x, win.y);
                e.Use();
            }
            if (_dragging && e.type == EventType.MouseDrag)
            {
                Settings.WinX.Value = e.mousePosition.x - _dragOffset.x;
                Settings.WinY.Value = e.mousePosition.y - _dragOffset.y;
                e.Use();
            }
            if (e.type == EventType.MouseUp) _dragging = false;
        }

        private void DrawTooltip(Rect win)
        {
            string tip = Widgets.HoverTooltip;
            if (string.IsNullOrEmpty(tip)) return;

            float w = Mathf.Min(340f, Draw.TextWidth(tip, Styles.Small) + 20f);
            float h = Styles.WrapSmall.CalcHeight(new GUIContent(tip), w - 18f) + 12f;
            var mouse = Event.current.mousePosition;

            float x = Mathf.Clamp(mouse.x + 14f, win.x + 4f, win.xMax - w - 4f);
            float y = mouse.y + 22f;
            if (y + h > win.yMax - 4f) y = mouse.y - h - 8f;

            var r = new Rect(x, y, w, h);
            Draw.Shadow(r, Theme.P.Shadow, 7f, 8f, 4);
            Draw.Card(r, Theme.P.SurfaceAlt, Theme.P.BorderStrong, 7f);
            Draw.Label(new Rect(r.x + 9f, r.y + 6f, r.width - 18f, r.height - 12f), tip, Styles.WrapSmall, Theme.P.TextMuted);
        }

        /// <summary>
        /// Reads the menu key straight from the IMGUI event stream.
        ///
        /// This is the primary toggle and the reason the menu can be trusted to open: OnGUI
        /// receives key events from the engine itself, so it works whether the project enabled
        /// the legacy input manager, the Input System package, or both. The previous build
        /// relied solely on UnityEngine.Input, which throws on a game that disabled it — and
        /// the menu simply never opened.
        /// </summary>
        private void HandleMenuKeyEvent()
        {
            var e = Event.current;
            if (e == null || e.type != EventType.KeyDown) return;

            // A rebind is capturing keys, or the user is typing in a text field.
            if (Widgets.IsCapturingKey) return;
            if (_open && GUIUtility.keyboardControl != 0 && e.keyCode != KeyCode.Escape) return;

            if (e.keyCode == Settings.MenuKey.Value || e.keyCode == Settings.MenuKeyAlt.Value) { RequestToggle(); e.Use(); }
            else if (e.keyCode == Settings.PanicKey.Value) { Panic(); e.Use(); }
            else if (e.keyCode == KeyCode.Escape && _open) { SetOpen(false); e.Use(); }
        }

        /// <summary>
        /// A short-lived banner confirming the plugin is alive.
        ///
        /// It exists to split the two failure modes that look identical to a player: "the
        /// plugin never loaded" and "the plugin loaded but the key does nothing". Seeing this
        /// means the only thing left to doubt is the keybind.
        /// </summary>
        private void DrawStartupBanner(float logicalW, float logicalH)
        {
            const float lifetime = 18f;
            float age = Time.unscaledTime - _loadedAt;
            if (age > lifetime || _open) return;

            float fade = Mathf.Min(Anim.EaseOutCubic(Mathf.Clamp01(age / 0.35f)),
                                   Mathf.Clamp01((lifetime - age) / 1.2f));
            if (fade <= 0.01f) return;

            var p = Theme.P;
            int ok = 0;
            foreach (var b in GameBridge.All) if (b.Ok) ok++;

            string title = $"GambleMenu {Plugin.Version} loaded";
            string hint = $"Press {Settings.MenuKey.Value} or {Settings.MenuKeyAlt.Value} to open" +
                          (Settings.Handle.Index != 2 && !Settings.EverOpened.Value ? ", or click the tab at the edge" : "") +
                          $"  ·  {ModRegistry.All.Count} mods";

            float w = Mathf.Max(Draw.TextWidth(title, Styles.Strong), Draw.TextWidth(hint, Styles.Small)) + 46f;
            var r = new Rect((logicalW - w) * 0.5f, logicalH - 96f, w, 54f);

            Draw.Alpha = fade;
            Draw.Shadow(r, p.Shadow, 10f, 12f, 5);
            Draw.Card(r, p.SurfaceAlt, p.BorderStrong, 10f);
            Draw.Round(new Rect(r.x + 1f, r.y + 10f, 3f, r.height - 20f), Theme.Accent, 1.5f);
            Draw.Dot(new Rect(r.x + 14f, r.y, 12f, r.height), Theme.Accent, 8f);
            Draw.Label(new Rect(r.x + 34f, r.y + 9f, r.width - 44f, 18f), title, Styles.Strong, p.Text);
            Draw.Label(new Rect(r.x + 34f, r.y + 28f, r.width - 44f, 16f), hint, Styles.Small, p.TextMuted);
            Draw.Alpha = 1f;
        }

        /// <summary>
        /// A small tab at the screen edge that opens the menu when clicked.
        ///
        /// This is the escape hatch for the failure that has no other remedy: if no key opens
        /// the menu, no amount of rebinding inside the menu can help, because you cannot get
        /// into it to rebind anything. A mouse target needs no keyboard and no input backend.
        /// </summary>
        private void DrawOpenHandle(float logicalW, float logicalH)
        {
            if (_open) return;
            if (Settings.Handle.Index == 2) return;                              // Never
            if (Settings.Handle.Index == 0 && Settings.EverOpened.Value) return; // Until first opened

            var p = Theme.P;
            Rect r;
            bool vertical;

            switch (Settings.HandleSide.Index)
            {
                case 1: r = new Rect(0f, logicalH * 0.34f, 24f, 84f); vertical = true; break;
                case 2: r = new Rect(logicalW * 0.5f - 52f, 0f, 104f, 24f); vertical = false; break;
                default: r = new Rect(logicalW - 24f, logicalH * 0.34f, 24f, 84f); vertical = true; break;
            }

            bool hover = r.Contains(Event.current.mousePosition);
            float grow = Anim.To("handle.h", hover ? 1f : 0f, 16f);

            // Grows outward from its edge on hover, so it is obviously clickable without
            // taking up room the rest of the time.
            if (vertical)
            {
                float extra = grow * 6f;
                r = Settings.HandleSide.Index == 1
                    ? new Rect(r.x, r.y, r.width + extra, r.height)
                    : new Rect(r.x - extra, r.y, r.width + extra, r.height);
            }
            else
            {
                r = new Rect(r.x, r.y, r.width, r.height + grow * 5f);
            }

            Draw.Shadow(r, p.Shadow, 8f, 8f, 4);
            Draw.Card(r, Color.Lerp(p.SurfaceAlt, p.SurfaceHover, grow), Theme.Fade(Theme.Accent, 0.5f + grow * 0.4f), 7f);

            var dot = new Rect(r.x + r.width * 0.5f - 4f, r.y + (vertical ? 12f : r.height * 0.5f - 4f), 8f, 8f);
            Draw.Round(dot, Theme.Accent, 4f);

            if (vertical)
            {
                // Stacked letters: IMGUI cannot rotate text without a matrix push per glyph,
                // and a five-letter column is legible enough at this size.
                const string word = "MENU";
                for (int i = 0; i < word.Length; i++)
                    Draw.Label(new Rect(r.x, r.y + 26f + i * 12f, r.width, 12f),
                               word[i].ToString(), Styles.KickerCentre, Color.Lerp(p.TextMuted, p.Text, grow));
            }
            else
            {
                Draw.Label(new Rect(r.x + 16f, r.y, r.width - 20f, r.height), "MODS", Styles.KickerCentre,
                           Color.Lerp(p.TextMuted, p.Text, grow));
            }

            if (Event.current.type == EventType.MouseDown && Event.current.button == 0 && hover)
            {
                RequestToggle();
                Event.current.Use();
            }
        }

        private void DrawWatermark(float logicalW)
        {
            var p = Theme.P;
            string fps = (1f / Mathf.Max(0.0001f, Time.unscaledDeltaTime)).ToString("0", CultureInfo.InvariantCulture);
            string role = GameBridge.IsConnected ? (GameBridge.IsHost ? "host" : "client") : "offline";
            string text = $"GambleMenu · {ModRegistry.EnabledCount} on · {role} · {fps} fps";

            float w = Draw.TextWidth(text, Styles.Small) + 26f;
            var r = new Rect(logicalW - w - 14f, 14f, w, 24f);
            Draw.Card(r, Theme.Fade(p.Surface, 0.9f), p.Border, 6f);
            Draw.Round(new Rect(r.x + 9f, r.y + 9f, 6f, 6f), Theme.Accent, 3f);
            Draw.Label(new Rect(r.x + 21f, r.y, r.width - 28f, r.height), text, Styles.Small, p.TextMuted);
        }

        private void DrawToasts(float logicalW, float logicalH)
        {
            var list = Notifier.Active;
            if (list.Count == 0) return;

            var p = Theme.P;
            const float w = 320f;
            float y = logicalH - 20f;

            for (int i = list.Count - 1; i >= 0; i--)
            {
                var toast = list[i];
                float age = Time.unscaledTime - toast.Born;
                float appear = Anim.EaseOutCubic(Mathf.Clamp01(age / 0.18f));
                float fade = Mathf.Clamp01((toast.Lifetime - age) / 0.4f);

                string text = toast.Repeats > 1 ? $"{toast.Message}  (×{toast.Repeats})" : toast.Message;
                float h = Mathf.Max(38f, Styles.WrapSmall.CalcHeight(new GUIContent(text), w - 54f) + 22f);
                y -= h + 8f;

                float x = logicalW - w - 20f + (1f - appear) * 24f;
                var r = new Rect(x, y, w, h);

                Color accent = toast.Kind == ToastKind.Error ? p.Danger
                             : toast.Kind == ToastKind.Warn ? p.Warn
                             : toast.Kind == ToastKind.Success ? p.Success : p.Info;

                Draw.Alpha = fade * appear;

                Draw.Shadow(r, p.Shadow, 9f, 10f, 4);
                Draw.Card(r, p.SurfaceAlt, p.BorderStrong, 9f);
                Draw.Round(new Rect(r.x + 1f, r.y + 8f, 3f, r.height - 16f), accent, 1.5f);

                var icon = new Rect(r.x + 14f, r.y, 18f, r.height);
                switch (toast.Kind)
                {
                    case ToastKind.Success: Draw.Check(icon, accent); break;
                    case ToastKind.Error:
                    case ToastKind.Warn:    Draw.Bang(icon, accent);  break;
                    default:                Draw.Dot(icon, accent, 7f); break;
                }

                Draw.Label(new Rect(r.x + 40f, r.y + 10f, r.width - 52f, r.height - 20f), text, Styles.WrapSmall, p.Text);
            }
            Draw.Alpha = 1f;
        }

        // --- shared helpers for pages -----------------------------------------------

        public bool IsExpanded(string id) => _expanded.Contains(id);

        public void SetExpanded(string id, bool value)
        {
            if (value) _expanded.Add(id);
            else _expanded.Remove(id);
        }

        public void ToggleExpanded(string id) => SetExpanded(id, !IsExpanded(id));

        public void GoToPage(int index) => _page = index;

        public string Search => _search;
    }
}
