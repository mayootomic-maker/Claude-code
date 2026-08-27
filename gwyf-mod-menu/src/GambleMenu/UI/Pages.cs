using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using GambleMenu.Core;
using UnityEngine;

namespace GambleMenu.UI
{
    internal enum PageKind { Category, Settings, Profiles, Compatibility, About }

    internal sealed class SidebarEntry
    {
        public string Title;
        public bool IsSeparator;
        public int Count;
        public int ActiveCount;
        public PageKind Kind;
        public Category Cat;
    }

    /// <summary>
    /// Renders the right-hand pane. Every Draw* method returns the height it needed, which is
    /// what the scroll container clamps against — measuring separately would mean keeping a
    /// second layout pass in sync with the first for no gain.
    /// </summary>
    internal sealed class Pages
    {
        private const float CardRadius = 8f;
        private const float RowH = 28f;

        private string _newProfileName = "";
        private readonly HashSet<string> _colorOpen = new HashSet<string>();

        // --- sidebar ----------------------------------------------------------------

        public List<SidebarEntry> SidebarEntries()
        {
            var list = new List<SidebarEntry>();
            foreach (var cat in ModRegistry.UsedCategories())
            {
                var mods = ModRegistry.InCategory(cat).Where(Visible).ToList();
                if (mods.Count == 0) continue;
                list.Add(new SidebarEntry
                {
                    Title = Pretty(cat),
                    Kind = PageKind.Category,
                    Cat = cat,
                    Count = mods.Count,
                    ActiveCount = mods.Count(m => m.Enabled.Value)
                });
            }

            list.Add(new SidebarEntry { IsSeparator = true });
            list.Add(new SidebarEntry { Title = "Settings", Kind = PageKind.Settings });
            list.Add(new SidebarEntry { Title = "Profiles", Kind = PageKind.Profiles });
            list.Add(new SidebarEntry { Title = "Compatibility", Kind = PageKind.Compatibility });
            list.Add(new SidebarEntry { Title = "About", Kind = PageKind.About });
            return list;
        }

        /// <summary>A mod is listed unless this game build cannot support it at all.</summary>
        private static bool Visible(Mod m) => m.BindingsOk || Settings.ShowUnavailable.Value;

        private static string Pretty(Category c)
        {
            switch (c)
            {
                case Category.Economy:     return "Economy";
                case Category.Machines:    return "Machines";
                case Category.Timing:      return "Time";
                case Category.Progression: return "Progression";
                case Category.Saves:       return "Saves";
                case Category.Player:      return "Player";
                case Category.Visual:      return "Visuals";
                case Category.Performance: return "Performance";
                case Category.Automation:  return "Automation";
                case Category.Session:     return "Session";
                case Category.Developer:   return "Developer";
                default:                   return c.ToString();
            }
        }

        // --- dispatch ---------------------------------------------------------------

        /// <summary>
        /// Search results across every category.
        ///
        /// The old behaviour filtered only inside the selected category, which is backwards:
        /// you search precisely because you do not know where a mod lives. Typing now looks
        /// everywhere, and the category is shown against each hit so the answer also teaches
        /// you where it was.
        /// </summary>
        public float DrawSearch(Rect view, float scroll, string search, MenuController menu)
        {
            GUI.BeginGroup(view);
            Widgets.PushGroup(view);
            float height;

            try
            {
                var r = new Rect(0f, -scroll, view.width, view.height + scroll);
                var p = Theme.P;
                float y = r.y;

                var hits = ModRegistry.All
                                      .Where(Visible)
                                      .Where(m => m.MatchesSearch(search))
                                      .OrderBy(m => m.Cat)
                                      .ToList();

                var head = new Rect(r.x, y, r.width - 6f, 24f);
                Draw.Label(new Rect(head.x + 2f, head.y, 220f, head.height), "SEARCH", Styles.Kicker, p.TextMuted);
                Draw.Label(new Rect(head.x + 74f, head.y, head.width - 84f, head.height),
                           hits.Count == 1 ? $"one match for \u201c{search}\u201d"
                                           : $"{hits.Count} matches for \u201c{search}\u201d",
                           Styles.Small, p.TextFaint);
                y += 33f;

                if (hits.Count == 0)
                {
                    DrawEmpty(new Rect(r.x, y, r.width - 6f, 110f),
                              $"Nothing matches \u201c{search}\u201d.",
                              "Names, descriptions, categories and option labels are all searched.");
                    height = y + 110f - r.y;
                }
                else
                {
                    Category? lastCat = null;
                    foreach (var mod in hits)
                    {
                        if (lastCat != mod.Cat)
                        {
                            lastCat = mod.Cat;
                            var label = new Rect(r.x + 2f, y, r.width, 18f);
                            Icons.Draw(mod.Cat, new Rect(label.x, label.y + 2f, 13f, 13f), Theme.Fade(p.TextFaint, 0.9f));
                            Draw.Label(new Rect(label.x + 19f, label.y, 200f, 18f),
                                       Pretty(mod.Cat).ToUpperInvariant(), Styles.KickerSmall, p.TextFaint);
                            y += 22f;
                        }
                        y += DrawModCard(new Rect(r.x, y, r.width - 6f, 0f), mod, menu) + 7f;
                    }
                    height = y - r.y + 4f;
                }
            }
            finally
            {
                Widgets.PopGroup(view);
                GUI.EndGroup();
            }
            return height;
        }

        public float DrawPage(int pageIndex, Rect view, float scroll, string search, MenuController menu)
        {
            var entries = SidebarEntries();
            if (pageIndex < 0 || pageIndex >= entries.Count) return 0f;
            var entry = entries[pageIndex];
            if (entry.IsSeparator) return 0f;

            GUI.BeginGroup(view);
            Widgets.PushGroup(view);

            var local = new Rect(0f, -scroll, view.width, view.height + scroll);
            float height;
            try
            {
                switch (entry.Kind)
                {
                    case PageKind.Category:      height = DrawMods(local, entry.Cat, search, menu); break;
                    case PageKind.Settings:      height = DrawSettings(local); break;
                    case PageKind.Profiles:      height = DrawProfiles(local); break;
                    case PageKind.Compatibility: height = DrawCompatibility(local); break;
                    default:                     height = DrawAbout(local); break;
                }
            }
            finally
            {
                Widgets.PopGroup(view);
                GUI.EndGroup();
            }
            return height;
        }

        // --- mods -------------------------------------------------------------------

        /// <summary>Short line under the category heading, so a page opens with context
        /// rather than dropping straight into a list of switches.</summary>
        private static string Blurb(Category c)
        {
            switch (c)
            {
                case Category.Economy:     return "the bank and the loan shark";
                case Category.Machines:    return "read what a machine is about to do";
                case Category.Timing:      return "how long a day lasts, and how fast";
                case Category.Progression: return "the tower and the floors";
                case Category.Saves:       return "permanent edits, written to disk";
                case Category.Player:      return "local movement only";
                case Category.Visual:      return "nothing here touches game state";
                case Category.Performance: return "frames per second, restored on exit";
                case Category.Automation:  return "things that run on a timer";
                case Category.Session:     return "the lobby and your role in it";
                case Category.Developer:   return "reach past what the menu already knows";
                default:                   return "";
            }
        }

        private float DrawMods(Rect r, Category cat, string search, MenuController menu)
        {
            var p = Theme.P;
            var all = ModRegistry.InCategory(cat).Where(Visible).ToList();
            var mods = all.Where(m => m.MatchesSearch(search)).ToList();
            int on = all.Count(m => m.Enabled.Value);

            float y = r.y;

            // --- category heading
            var head = new Rect(r.x, y, r.width - 6f, 24f);
            Draw.Label(new Rect(head.x + 2f, head.y, 200f, head.height), Pretty(cat).ToUpperInvariant(), Styles.Kicker, p.TextMuted);

            float kickerW = Draw.TextWidth(Pretty(cat).ToUpperInvariant(), Styles.Kicker) + 20f;
            string sub = on > 0 ? $"{Blurb(cat)}  ·  {on} of {all.Count} on" : Blurb(cat);
            Draw.Label(new Rect(head.x + kickerW, head.y, head.width - kickerW - 110f, head.height), sub, Styles.Small, p.TextFaint);

            if (on > 0 && Widgets.Button(new Rect(head.xMax - 96f, head.y, 96f, 22f), "turn all off",
                                         ButtonKind.Ghost, true, $"Switch off the {on} running mod(s) in this category.",
                                         "cat.alloff." + cat))
            {
                int n = ModRegistry.DisableCategory(cat);
                Notifier.Info($"{n} mod(s) switched off in {Pretty(cat)}.");
            }
            y += 33f;

            if (mods.Count == 0)
            {
                DrawEmpty(new Rect(r.x, y, r.width - 6f, 110f),
                          string.IsNullOrEmpty(search) ? "Nothing in this category yet."
                                                       : $"No mod in {Pretty(cat)} matches \u201c{search}\u201d.",
                          string.IsNullOrEmpty(search) ? null : "Clear the search box to see everything again.");
                return y + 110f - r.y;
            }

            foreach (var mod in mods)
                y += DrawModCard(new Rect(r.x, y, r.width - 6f, 0f), mod, menu) + 7f;

            return y - r.y + 4f;
        }

        private float DrawModCard(Rect at, Mod mod, MenuController menu)
        {
            var p = Theme.P;
            string blocked = mod.BlockedReason();
            bool usable = blocked == null;
            bool expanded = menu.IsExpanded(mod.Id);
            float exp = Anim.To(mod.Id + ".exp", expanded ? 1f : 0f, 16f);

            bool hasBody = mod.Options.Count > 0 || mod.Actions.Count > 0 || blocked != null;
            float bodyH = hasBody ? MeasureBody(mod, at.width, blocked) : 0f;
            const float headH = 44f;
            float height = headH + bodyH * exp;

            var card = new Rect(at.x, at.y, at.width, height);
            bool hover = card.Contains(Event.current.mousePosition);
            float hl = Anim.To(mod.Id + ".card", hover ? 1f : 0f, 16f);

            Color fill = mod.Enabled.Value ? p.SurfaceActive : p.Surface;
            fill = Color.Lerp(fill, p.SurfaceHover, hl * 0.45f);
            Color border = mod.Enabled.Value
                ? Theme.Fade(Theme.Accent, 0.5f)
                : Color.Lerp(p.Border, p.BorderStrong, hl);

            // A running mod gets a soft halo, the same trick the world markers use to say
            // "this one is live" without shouting it in a different colour.
            if (mod.Enabled.Value)
                Draw.Shadow(card, Theme.Fade(Theme.Accent, 0.16f), 8f, 7f, 3);

            Draw.Card(card, fill, border, 8f);

            if (mod.Enabled.Value)
                Draw.Round(new Rect(card.x, card.y + 9f, 3f, 26f), Theme.Accent, 1.5f);

            var head = new Rect(card.x, card.y, card.width, headH);

            // Fixed right-hand columns. Deriving the badge position from the title's text
            // width, as this used to, left every row's badge at a different x — a ragged
            // edge down the whole list.
            const float swW = 34f, swH = 18f;
            var toggleRect = new Rect(head.xMax - 15f - swW, head.y + (headH - swH) * 0.5f, swW, swH);
            var chevRect   = new Rect(head.xMax - 78f, head.y, 18f, headH);
            float badgeRight = head.xMax - 84f;

            var nameRect = new Rect(head.x + 16f, head.y + 6f, head.width - 190f, 16f);
            Draw.Label(nameRect, Draw.Elide(mod.Name, Styles.Strong, nameRect.width), Styles.Strong,
                       usable ? p.Text : p.TextMuted);

            var descRect = new Rect(head.x + 16f, head.y + 23f, head.width - 168f, 15f);
            Draw.Label(descRect, Draw.Elide(mod.Description, Styles.Small, descRect.width), Styles.Small,
                       usable ? p.TextMuted : Theme.Fade(p.TextMuted, 0.7f));

            DrawModBadges(mod, badgeRight, head.y + (headH - 15f) * 0.5f, usable);

            if (mod.IsToggle)
            {
                bool now = Widgets.Switch(new Rect(toggleRect.x, head.y, swW, headH), mod.Id,
                                          mod.Enabled.Value, usable, usable ? null : blocked);
                if (now != mod.Enabled.Value)
                {
                    mod.Enabled.Value = now;
                    if (mod.Enabled.Value && !ConfigStore.IsLoading) Notifier.Success($"{mod.Name} on");
                }
            }
            else if (!usable)
            {
                Draw.Lock(new Rect(toggleRect.x + 8f, head.y, 18f, headH), p.TextFaint);
            }

            if (hasBody)
            {
                Draw.Chevron(chevRect, hover ? p.TextMuted : Theme.Fade(p.TextFaint, 0.9f), Mathf.Lerp(-90f, 0f, exp), 1.5f);
                var hit = new Rect(head.x, head.y, head.width - (mod.IsToggle ? 58f : 30f), headH);
                if (Event.current.type == EventType.MouseDown && Event.current.button == 0 && hit.Contains(Event.current.mousePosition))
                {
                    menu.ToggleExpanded(mod.Id);
                    Event.current.Use();
                }
            }

            if (hasBody && exp > 0.002f)
            {
                var bodyClip = new Rect(card.x + 1f, head.yMax, card.width - 2f, Mathf.Max(0f, height - headH));
                GUI.BeginGroup(bodyClip);
                Widgets.PushGroup(bodyClip);
                try { DrawModBody(new Rect(0f, 0f, bodyClip.width, bodyH), mod, blocked); }
                finally { Widgets.PopGroup(bodyClip); GUI.EndGroup(); }
            }

            return height;
        }

        /// <summary>
        /// Draws the authority chip, right-aligned at a fixed column.
        ///
        /// It is deliberately quiet unless it is actually stopping you: in a category where
        /// every mod is host-only, seven bright chips down one edge is a stripe of noise that
        /// says nothing. It lights up only when the rule is currently biting.
        /// </summary>
        private void DrawModBadges(Mod mod, float right, float y, bool usable)
        {
            var p = Theme.P;
            string text = null;
            Color colour = p.TextFaint;

            if (mod.Fault != null) { text = "ERROR"; colour = p.Danger; }
            else if (!mod.BindingsOk) { text = "N/A"; colour = p.TextFaint; }
            else if (mod.Auth == Authority.HostOnly) { text = "HOST"; colour = usable ? p.TextFaint : p.Info; }
            else if (mod.Auth == Authority.SoloOnly) { text = "SOLO"; colour = usable ? p.TextFaint : p.Warn; }

            if (text == null) return;

            float w = Draw.TextWidth(text, Styles.KickerSmall) + 12f;
            var r = new Rect(right - w, y, w, 15f);

            // Only a live block earns a filled chip; otherwise it is a faint label.
            if (!usable) Draw.Round(r, Theme.Fade(colour, 0.14f), 3f);
            Draw.Label(r, text, Styles.KickerCentre, colour);
        }

        private float MeasureBody(Mod mod, float width, string blocked)
        {
            float h = 8f;
            if (blocked != null)
                h += Styles.WrapSmall.CalcHeight(new GUIContent(blocked), width - 60f) + 16f;

            foreach (var o in mod.Options)
            {
                if (!o.Visible) continue;
                h += RowH;
                if (o is ColorOption c && _colorOpen.Contains(c.Key)) h += 92f;
            }
            if (mod.Actions.Count > 0) h += 34f;
            float custom = mod.BodyHeight(width - 34f);
            if (custom > 0f) h += custom + 8f;
            return h + 9f;
        }

        private void DrawModBody(Rect r, Mod mod, string blocked)
        {
            var p = Theme.P;
            float y = r.y + 6f;
            float pad = 15f;
            float w = r.width - pad * 2f;

            Widgets.Divider(new Rect(r.x + pad, y - 6f, w, 1f));

            if (blocked != null)
            {
                float h = Styles.WrapSmall.CalcHeight(new GUIContent(blocked), w - 34f);
                var box = new Rect(r.x + pad, y + 4f, w, h + 14f);
                Color tint = mod.Fault != null ? p.Danger : p.Warn;
                Draw.Card(box, Theme.Fade(tint, 0.10f), Theme.Fade(tint, 0.35f), 6f);
                Draw.Bang(new Rect(box.x + 8f, box.y, 16f, box.height), tint);
                Draw.Label(new Rect(box.x + 30f, box.y + 7f, box.width - 40f, h), blocked, Styles.WrapSmall, p.Text);
                y += box.height + 8f;
            }

            bool interactable = blocked == null;
            foreach (var opt in mod.Options)
            {
                if (!opt.Visible) continue;
                var row = new Rect(r.x + pad, y, w, RowH);
                DrawOption(row, opt, interactable);
                y += RowH;

                if (opt is ColorOption col && _colorOpen.Contains(col.Key))
                {
                    var channels = new Rect(row.x + 14f, y + 2f, w - 28f, 84f);
                    Draw.Card(new Rect(row.x, y, w, 88f), Theme.P.SurfaceSunken, Theme.P.Border, 6f);
                    Widgets.ColorChannels(channels, col);
                    y += 92f;
                }
            }

            if (mod.Actions.Count > 0)
            {
                y += 2f;
                float bx = r.x + pad;
                foreach (var action in mod.Actions)
                {
                    bool can = interactable && (action.CanRun == null || action.CanRun());
                    float bw = Mathf.Min(190f, Draw.TextWidth(action.Label, Styles.Body) + 28f);
                    var br = new Rect(bx, y, bw, 26f);
                    if (bx + bw > r.x + r.width - pad) break; // no wrapping: keep the row honest
                    if (Widgets.Button(br, action.Label, action.Destructive ? ButtonKind.Danger : ButtonKind.Normal, can,
                                       action.Tooltip, mod.Id + "." + action.Label))
                        RunAction(mod, action);
                    bx += bw + 8f;
                }
                y += 34f;
            }

            float customH = mod.BodyHeight(r.width - pad * 2f);
            if (customH > 0f)
            {
                try { mod.DrawBody(new Rect(r.x + pad, y + 4f, r.width - pad * 2f, customH)); }
                catch (Exception ex)
                {
                    Log.Error($"{mod.Id} custom body threw: {ex}");
                    Draw.Label(new Rect(r.x + pad, y + 4f, r.width - pad * 2f, 20f),
                               "this panel failed to draw — see the log", Styles.Small, Theme.P.Danger);
                }
            }
        }

        private void RunAction(Mod mod, ModAction action)
        {
            try { action.Run?.Invoke(); }
            catch (Exception ex)
            {
                Log.Error($"{mod.Id} action '{action.Label}' threw: {ex}");
                Notifier.Error($"{action.Label} failed: {ex.Message}");
            }
        }

        /// <summary>One settings row: label on the left, the control on the right.</summary>
        public void DrawOption(Rect row, Option opt, bool interactable)
        {
            var p = Theme.P;
            float labelW = row.width * 0.44f;
            var labelRect = new Rect(row.x, row.y, labelW, row.height);
            var ctrlRect = new Rect(row.x + labelW, row.y, row.width - labelW, row.height);

            Draw.Label(labelRect, Draw.Elide(opt.Label, Styles.Body, labelW - 8f), Styles.Body,
                       interactable ? p.Text : p.TextFaint);
            // Hovering the label explains the setting too, not just the control itself.
            Widgets.SetTooltip(labelRect, opt.Tooltip);

            switch (opt)
            {
                case BoolOption b:
                {
                    bool now = Widgets.Switch(ctrlRect, b.Key, b.Value, interactable, opt.Tooltip);
                    if (now != b.Value) b.Value = now;
                    break;
                }
                case FloatOption f:
                    Widgets.Slider(new Rect(ctrlRect.x, ctrlRect.y, ctrlRect.width, ctrlRect.height), f, interactable);
                    break;
                case IntOption i:
                    Widgets.Slider(new Rect(ctrlRect.x, ctrlRect.y, ctrlRect.width, ctrlRect.height), i, interactable);
                    break;
                case LongOption l:
                    Widgets.LongField(new Rect(ctrlRect.x, ctrlRect.y + 3f, ctrlRect.width, ctrlRect.height - 6f), l, interactable);
                    break;
                case EnumOption e:
                    Widgets.Dropdown(new Rect(ctrlRect.x, ctrlRect.y + 3f, ctrlRect.width, ctrlRect.height - 6f), e, interactable);
                    break;
                case KeyOption k:
                    Widgets.KeyBind(ctrlRect, k, interactable);
                    break;
                case ColorOption c:
                {
                    bool open = _colorOpen.Contains(c.Key);
                    bool was = open;
                    Widgets.ColorField(ctrlRect, c, ref open);
                    if (open != was)
                    {
                        if (open) _colorOpen.Add(c.Key); else _colorOpen.Remove(c.Key);
                    }
                    break;
                }
                case StringOption s:
                {
                    var fr = new Rect(ctrlRect.x, ctrlRect.y + 3f, ctrlRect.width, ctrlRect.height - 6f);
                    string now = Widgets.TextField(fr, s.Key + ".txt", s.Value, s.Placeholder, interactable);
                    if (now != s.Value) s.Value = now;
                    break;
                }
            }
        }

        // --- settings ---------------------------------------------------------------

        private float DrawSettings(Rect r)
        {
            float y = r.y;
            y += Section(new Rect(r.x, y, r.width, 0f), "Interface",
                         Settings.All.Where(o => o.Key.StartsWith("menu.", StringComparison.Ordinal)).ToList());
            y += 12f;
            y += Section(new Rect(r.x, y, r.width, 0f), "Safety",
                         Settings.All.Where(o => o.Key.StartsWith("safety.", StringComparison.Ordinal)).ToList());
            y += 12f;
            y += Section(new Rect(r.x, y, r.width, 0f), "Diagnostics",
                         Settings.All.Where(o => o.Key.StartsWith("debug.", StringComparison.Ordinal)).ToList());

            y += 14f;
            var buttons = new Rect(r.x, y, r.width, 30f);
            if (Widgets.Button(new Rect(buttons.x, buttons.y, 150f, 28f), "Reset everything", ButtonKind.Danger, true,
                               "Puts every setting and every mod option back to its default."))
            {
                ConfigStore.ResetAllToDefaults();
            }
            if (Widgets.Button(new Rect(buttons.x + 158f, buttons.y, 130f, 28f), "Save now", ButtonKind.Normal, true,
                               "Settings also save automatically when the menu closes."))
            {
                ConfigStore.SaveActive();
                Notifier.Success("Settings saved.");
            }
            if (Widgets.Button(new Rect(buttons.x + 296f, buttons.y, 150f, 28f), "Open config folder", ButtonKind.Ghost, true,
                               ConfigStore.Root))
            {
                Application.OpenURL("file://" + ConfigStore.Root);
            }
            y += 40f;
            return y - r.y;
        }

        private float Section(Rect at, string title, List<Option> options)
        {
            var p = Theme.P;
            float rows = options.Count(o => o.Visible);
            float h = 38f + rows * RowH + 12f;
            var card = new Rect(at.x, at.y, at.width - 6f, h);

            Draw.Card(card, p.Surface, p.Border, CardRadius);
            Draw.Label(new Rect(card.x + 17f, card.y + 10f, card.width - 34f, 18f), title.ToUpperInvariant(), Styles.Caption, p.TextFaint);
            Widgets.Divider(new Rect(card.x + 17f, card.y + 32f, card.width - 34f, 1f));

            float y = card.y + 38f;
            foreach (var opt in options)
            {
                if (!opt.Visible) continue;
                DrawOption(new Rect(card.x + 17f, y, card.width - 34f, RowH), opt, true);
                y += RowH;
            }
            return h;
        }

        // --- profiles ---------------------------------------------------------------

        private float DrawProfiles(Rect r)
        {
            var p = Theme.P;
            float y = r.y;

            var intro = new Rect(r.x, y, r.width - 6f, 78f);
            Draw.Card(intro, p.Surface, p.Border, CardRadius);
            Draw.Label(new Rect(intro.x + 17f, intro.y + 10f, intro.width - 34f, 18f), "PROFILES", Styles.Caption, p.TextFaint);
            Draw.Label(new Rect(intro.x + 17f, intro.y + 30f, intro.width - 34f, 36f),
                       "A profile stores every setting and every mod option. Handy for keeping a quiet quality-of-life set apart from a full sandbox set.",
                       Styles.WrapSmall, p.TextMuted);
            y += intro.height + 10f;

            var newRow = new Rect(r.x, y, r.width - 6f, 40f);
            Draw.Card(newRow, p.Surface, p.Border, CardRadius);
            var field = new Rect(newRow.x + 14f, newRow.y + 7f, newRow.width - 150f, 26f);
            _newProfileName = Widgets.TextField(field, "gm.newprofile", _newProfileName, "New profile name…");
            if (Widgets.Button(new Rect(field.xMax + 8f, newRow.y + 7f, 116f, 26f), "Save current", ButtonKind.Primary, true,
                               "Writes everything as it is right now into a named profile."))
            {
                if (ConfigStore.SaveProfile(_newProfileName)) _newProfileName = "";
            }
            y += newRow.height + 10f;

            var profiles = ConfigStore.ListProfiles();
            if (profiles.Count == 0)
            {
                DrawEmpty(new Rect(r.x, y, r.width - 6f, 100f), "No profiles saved yet.",
                          "Name one above and press Save current.");
                return y + 100f - r.y;
            }

            foreach (var name in profiles)
            {
                var row = new Rect(r.x, y, r.width - 6f, 44f);
                bool hover = row.Contains(Event.current.mousePosition);
                float hl = Anim.To("prof." + name, hover ? 1f : 0f, 16f);
                Draw.Card(row, Color.Lerp(p.Surface, p.SurfaceHover, hl * 0.6f), p.Border, CardRadius);

                Draw.Label(new Rect(row.x + 17f, row.y, row.width - 250f, row.height),
                           Draw.Elide(name, Styles.Body, row.width - 260f), Styles.Body, p.Text);

                if (Widgets.Button(new Rect(row.xMax - 216f, row.y + 9f, 74f, 26f), "Load", ButtonKind.Normal, true,
                                   "Applies this profile over your current settings.", "prof.load." + name))
                    ConfigStore.LoadProfile(name);

                if (Widgets.Button(new Rect(row.xMax - 136f, row.y + 9f, 74f, 26f), "Overwrite", ButtonKind.Ghost, true,
                                   "Replaces this profile with your current settings.", "prof.over." + name))
                    ConfigStore.SaveProfile(name);

                if (Widgets.Button(new Rect(row.xMax - 56f, row.y + 9f, 40f, 26f), "", ButtonKind.Ghost, true,
                                   "Delete this profile", "prof.del." + name))
                    ConfigStore.DeleteProfile(name);
                Draw.Cross(new Rect(row.xMax - 56f, row.y + 9f, 40f, 26f), p.Danger, 1.6f);

                y += row.height + 8f;
            }
            return y - r.y;
        }

        // --- compatibility ----------------------------------------------------------

        private float DrawCompatibility(Rect r)
        {
            var p = Theme.P;
            float y = r.y;
            int ok = GameBridge.All.Count(b => b.Ok);
            int total = GameBridge.All.Count;

            var summary = new Rect(r.x, y, r.width - 6f, 92f);
            Draw.Card(summary, p.Surface, p.Border, CardRadius);
            Draw.Label(new Rect(summary.x + 17f, summary.y + 10f, summary.width - 34f, 18f), "GAME BINDINGS", Styles.Caption, p.TextFaint);
            Draw.Label(new Rect(summary.x + 17f, summary.y + 30f, 200f, 22f), $"{ok} of {total} resolved", Styles.Heading,
                       ok == total ? p.Success : (ok > total / 2 ? p.Warn : p.Danger));

            var bar = new Rect(summary.x + 17f, summary.y + 58f, summary.width - 34f, 6f);
            Draw.Round(bar, p.Track, 3f);
            Draw.Round(new Rect(bar.x, bar.y, bar.width * (total == 0 ? 0f : ok / (float)total), 6f),
                       ok == total ? p.Success : p.Warn, 3f);

            Draw.Label(new Rect(summary.x + 17f, summary.y + 68f, summary.width - 34f, 18f),
                       "Anything unresolved means this build of the game renamed or removed it. Mods that need it are switched off, not broken.",
                       Styles.Tiny, p.TextFaint);
            y += summary.height + 10f;

            // The report is written on every launch. It is the single file worth sending when
            // something does not work, so it is named here rather than left to be discovered.
            var report = new Rect(r.x, y, r.width - 6f, 56f);
            Draw.Card(report, p.Surface, p.Border, CardRadius);
            Draw.Label(new Rect(report.x + 17f, report.y + 9f, report.width - 34f, 16f),
                       "STARTUP REPORT", Styles.Caption, p.TextFaint);
            Draw.Label(new Rect(report.x + 17f, report.y + 27f, report.width - 150f, 18f),
                       "Written every launch — what resolved, what the game exposes, what it can see.",
                       Styles.Small, p.TextMuted);
            if (Widgets.Button(new Rect(report.xMax - 128f, report.y + 16f, 112f, 26f), "Open it",
                               ButtonKind.Normal, true, Diagnostics.ReportPath, "compat.report"))
                Application.OpenURL("file://" + ConfigStore.Root);
            y += report.height + 10f;

            Draw.Label(new Rect(r.x + 4f, y, r.width, 20f), "INPUT", Styles.Caption, p.TextFaint);
            y += 22f;
            var inputRow = new Rect(r.x, y, r.width - 6f, 32f);
            Draw.Card(inputRow, p.Surface, p.Border, 7f);
            Draw.Label(new Rect(inputRow.x + 14f, inputRow.y, 220f, inputRow.height), "Keyboard backend", Styles.Body, p.Text);
            Draw.Label(new Rect(inputRow.x + 240f, inputRow.y, inputRow.width - 254f, inputRow.height),
                       InputBridge.BackendName, Styles.Body, p.TextMuted);
            y += inputRow.height + 12f;

            foreach (var group in GameBridge.All.GroupBy(b => b.Ok))
            {
                Draw.Label(new Rect(r.x + 4f, y, r.width, 20f),
                           group.Key ? "RESOLVED" : "NOT FOUND ON THIS BUILD", Styles.Caption,
                           group.Key ? p.TextFaint : p.Warn);
                y += 22f;

                foreach (var b in group.OrderBy(b => b.Id, StringComparer.Ordinal))
                {
                    var row = new Rect(r.x, y, r.width - 6f, 34f);
                    Draw.Card(row, p.Surface, p.Border, 7f);

                    var dot = new Rect(row.x + 12f, row.y, 10f, row.height);
                    Draw.Dot(dot, b.Ok ? p.Success : p.Danger, 6f);

                    Draw.Label(new Rect(row.x + 30f, row.y + 3f, row.width * 0.42f, 15f),
                               Draw.Elide(b.Id, Styles.Small, row.width * 0.42f), Styles.Small, p.Text);
                    Draw.Label(new Rect(row.x + 30f, row.y + 17f, row.width * 0.42f, 13f),
                               Draw.Elide(b.Purpose, Styles.Tiny, row.width * 0.42f), Styles.Tiny, p.TextFaint);

                    var detail = new Rect(row.x + row.width * 0.46f, row.y, row.width * 0.54f - 14f, row.height);
                    Draw.Label(detail, Draw.Elide(b.Detail, Styles.Tiny, detail.width), Styles.Tiny,
                               b.Ok ? p.TextMuted : p.Warn);

                    y += row.height + 5f;
                }
                y += 8f;
            }
            return y - r.y;
        }

        // --- about ------------------------------------------------------------------

        private float DrawAbout(Rect r)
        {
            var p = Theme.P;
            float y = r.y;

            var card = new Rect(r.x, y, r.width - 6f, 178f);
            Draw.Card(card, p.Surface, p.Border, CardRadius);
            Draw.Label(new Rect(card.x + 18f, card.y + 14f, card.width - 36f, 22f), "GambleMenu", Styles.Title, p.Text);
            Draw.Label(new Rect(card.x + 18f, card.y + 38f, card.width - 36f, 18f),
                       $"version {Plugin.Version}  ·  BepInEx 5  ·  Harmony", Styles.Small, p.TextFaint);

            Draw.Label(new Rect(card.x + 18f, card.y + 64f, card.width - 36f, 100f),
                       "A mod menu for Gamble With Your Friends.\n\n" +
                       "Nothing here is compiled against the game. Every hook is looked up by name when the " +
                       "game loads, so a game update makes a mod unavailable rather than crashing on launch — " +
                       "check the Compatibility page to see exactly what resolved.\n\n" +
                       "The game is co-op over Mirror with a server-authoritative simulation. Mods marked " +
                       "“host” change state only the host owns; running them as a guest desyncs the lobby " +
                       "instead of cheating in it, which is why they refuse.",
                       Styles.WrapSmall, p.TextMuted);
            y += card.height + 10f;

            var keys = new Rect(r.x, y, r.width - 6f, 96f);
            Draw.Card(keys, p.Surface, p.Border, CardRadius);
            Draw.Label(new Rect(keys.x + 17f, keys.y + 10f, keys.width - 34f, 18f), "KEYS", Styles.Caption, p.TextFaint);
            Draw.Label(new Rect(keys.x + 17f, keys.y + 32f, keys.width - 34f, 18f),
                       $"{Settings.MenuKey.Value} — open and close this menu", Styles.Small, p.TextMuted);
            Draw.Label(new Rect(keys.x + 17f, keys.y + 52f, keys.width - 34f, 18f),
                       $"{Settings.PanicKey.Value} — switch every mod off at once", Styles.Small, p.TextMuted);
            Draw.Label(new Rect(keys.x + 17f, keys.y + 72f, keys.width - 34f, 18f),
                       "Every mod can also take its own hotkey — expand a card to set one.", Styles.Small, p.TextFaint);
            y += keys.height + 10f;

            var paths = new Rect(r.x, y, r.width - 6f, 66f);
            Draw.Card(paths, p.Surface, p.Border, CardRadius);
            Draw.Label(new Rect(paths.x + 17f, paths.y + 10f, paths.width - 34f, 18f), "CONFIG", Styles.Caption, p.TextFaint);
            Draw.Label(new Rect(paths.x + 17f, paths.y + 32f, paths.width - 34f, 24f),
                       Draw.Elide(ConfigStore.Root, Styles.Small, paths.width - 34f), Styles.Small, p.TextMuted);
            y += paths.height + 8f;

            return y - r.y;
        }

        // --- shared -----------------------------------------------------------------

        private void DrawEmpty(Rect r, string title, string hint)
        {
            var p = Theme.P;
            Draw.Card(r, Theme.Fade(p.Surface, 0.6f), p.Border, CardRadius);
            Draw.Label(new Rect(r.x, r.y + r.height * 0.5f - (hint == null ? 8f : 18f), r.width, 20f),
                       title, Styles.BodyCentre, p.TextMuted);
            if (hint != null)
                Draw.Label(new Rect(r.x, r.y + r.height * 0.5f + 4f, r.width, 18f), hint, Styles.SmallCentre, p.TextFaint);
        }
    }
}
