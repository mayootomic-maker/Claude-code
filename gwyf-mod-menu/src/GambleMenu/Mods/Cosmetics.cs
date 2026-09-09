using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using GambleMenu.Core;
using GambleMenu.UI;

namespace GambleMenu.Mods
{
    /// <summary>
    /// Tickets, and the wardrobe they buy.
    ///
    /// The one part of this game that outlives a run. Tickets are earned by finishing a night
    /// in profit and spent at the second-hand store on cosmetics -- seven sections, one worn
    /// from each, two to six tickets apiece -- and none of it touches the odds. That is exactly
    /// why it was worth adding: every other mod here changes what happens to your money, and
    /// this one changes nothing except what you look like while it happens.
    ///
    /// Both fields are found by shape rather than by name, because nothing here has ever seen
    /// this part of the game. What the plugin settled on is printed on the card and in the
    /// startup report, so a wrong guess is visible rather than silent -- and the report now
    /// lists every field on SaveData, which is what turns the guess into a name.
    /// </summary>
    internal sealed class Tickets : Mod
    {
        public override string Id => "cosmetic.tickets";
        public override string Name => "Tickets";
        public override string Description =>
            "Reads and writes the tickets the second-hand store takes. Nothing here changes the odds.";
        public override Category Cat => Category.Progression;
        public override Authority Auth => Authority.HostOnly;
        public override bool IsToggle => false;
        public override string[] Tags => new[] { "ticket", "cosmetic", "shop", "nibor", "store", "wardrobe" };
        public override Binding[] Requires => new Binding[] { GameBridge.SdTickets };

        private IntOption _amount;

        protected override void Build()
        {
            _amount = Opt(new IntOption("cosmetic.tickets.value", "Tickets", 50, 0, 9999,
                "Cosmetics cost two to six each, so fifty is most of a wardrobe."));

            Act("Set to", () => Write(_amount.Value, "Tickets set to"));
            Act("Add", () =>
            {
                long? now = Read();
                if (!now.HasValue) { Notifier.Warn("Could not read the ticket count."); return; }
                Write(now.Value + _amount.Value, "Tickets now");
            }, "Adds to what you already have rather than replacing it.");
        }

        /* What the card shows under the buttons: the live count, and which field it came
           from. A number with no provenance is the thing that makes a wrong guess look like a
           working mod -- the field here was found by shape, so it has to say which one. */
        public override float BodyHeight(float width) => GameBridge.SdTickets.Ok ? 20f : 0f;

        public override void DrawBody(UnityEngine.Rect area)
        {
            if (!GameBridge.SdTickets.Ok) return;
            long? now = Read();
            string field = GameBridge.SdTickets.Field != null ? GameBridge.SdTickets.Field.Name : "?";
            string text = now.HasValue
                ? $"{now.Value.ToString(CultureInfo.InvariantCulture)} tickets  ·  SaveData.{field}"
                : $"no run loaded  ·  would read SaveData.{field}";
            Draw.Label(area, text, Styles.Small, Theme.P.TextMuted);
        }

        private static long? Read()
        {
            var live = RunState.Live;
            if (live == null || !GameBridge.SdTickets.Ok) return null;
            object v = GameBridge.SdTickets.Get(live);
            if (v == null) return null;
            try { return Convert.ToInt64(v); } catch { return null; }
        }

        private void Write(long value, string said)
        {
            var live = RunState.Live;
            if (live == null) { Notifier.Warn("No run is loaded."); return; }
            if (value < 0) value = 0;
            object typed;
            try { typed = Convert.ChangeType(value, GameBridge.SdTickets.Field.FieldType); }
            catch (Exception ex) { Notifier.Error($"Tickets are a {GameBridge.SdTickets.Field.FieldType.Name} on this build: {ex.Message}"); return; }
            if (!GameBridge.SdTickets.Set(live, typed)) { Notifier.Error("Could not write the ticket count."); return; }
            Notifier.Success($"{said} {value.ToString(CultureInfo.InvariantCulture)}.");
        }
    }

    /// <summary>
    /// Everything on the shelves, without the nights.
    ///
    /// The store re-randomises its stock every time you load the lobby, which means the rare
    /// thing you saw once is gone and may not come back for days of real play. This fills the
    /// unlocked set instead.
    ///
    /// It is deliberately additive and reversible-ish: what it can do is add ids to a
    /// collection the game already keeps, and it snapshots what was there first so "put it
    /// back" means something. What it cannot do is invent the ids -- so it reads them from
    /// wherever the game lists them, and if it cannot find a list it says so rather than
    /// writing guesses into a save.
    /// </summary>
    internal sealed class UnlockCosmetics : Mod
    {
        public override string Id => "cosmetic.unlock";
        public override string Name => "Unlock cosmetics";
        public override string Description =>
            "Adds every cosmetic the game knows about to your unlocked set. Appearance only — none of it changes the odds.";
        public override Category Cat => Category.Progression;
        public override Authority Auth => Authority.HostOnly;
        public override bool IsToggle => false;
        public override string[] Tags => new[] { "cosmetic", "unlock", "wardrobe", "hat", "outfit", "skin", "nibor" };
        public override Binding[] Requires => new Binding[] { GameBridge.SdCosmetics };

        private List<object> _before;

        protected override void Build()
        {
            Act("Unlock everything", Unlock,
                "Reads the ids from the game's own catalogue and adds any you do not have.");
            Act("Put it back", Restore,
                "Restores the set to what it was when this session first touched it.");
        }

        public override float BodyHeight(float width) => GameBridge.SdCosmetics.Ok ? 20f : 0f;

        public override void DrawBody(UnityEngine.Rect area)
        {
            if (!GameBridge.SdCosmetics.Ok) return;
            string field = GameBridge.SdCosmetics.Field != null ? GameBridge.SdCosmetics.Field.Name : "?";
            var set = Current();
            string text = set == null
                ? $"no run loaded  ·  would use SaveData.{field}"
                : $"{Count(set)} unlocked  ·  SaveData.{field}"
                  + (_before != null ? "  ·  original set remembered" : "");
            Draw.Label(area, text, Styles.Small, Theme.P.TextMuted);
        }

        private static object Current()
        {
            var live = RunState.Live;
            if (live == null || !GameBridge.SdCosmetics.Ok) return null;
            return GameBridge.SdCosmetics.Get(live);
        }

        private static int Count(object set)
        {
            if (set is ICollection c) return c.Count;
            int n = 0;
            if (set is IEnumerable e) foreach (var _ in e) n++;
            return n;
        }

        /// <summary>
        /// Every cosmetic id the game defines.
        ///
        /// Taken from the game's own catalogue rather than made up: the ids in a save have to
        /// be the ids the wardrobe screen looks for, and a hand-written list would be a set of
        /// entries that unlock nothing and cannot be told apart from ones that do. Looked for
        /// as any enum or static list whose name mentions cosmetics, which is where a Unity
        /// game of this shape keeps them.
        /// </summary>
        private static IList<object> Catalogue(Type wanted)
        {
            var found = new List<object>();
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                string name;
                try { name = asm.GetName().Name; } catch { continue; }
                if (!name.StartsWith("Assembly-CSharp", StringComparison.Ordinal)) continue;

                Type[] types;
                try { types = asm.GetTypes(); } catch { continue; }
                foreach (var t in types)
                {
                    string lower = t.Name.ToLowerInvariant();
                    if (lower.IndexOf("cosmetic", StringComparison.Ordinal) < 0
                        && lower.IndexOf("wardrobe", StringComparison.Ordinal) < 0
                        && lower.IndexOf("outfit", StringComparison.Ordinal) < 0) continue;

                    // An enum of ids is the common shape, and the values are the ids.
                    if (t.IsEnum)
                    {
                        foreach (var v in Enum.GetValues(t))
                            Take(found, v, wanted);
                        continue;
                    }
                    // Otherwise a static array or list of definitions, each carrying an id.
                    foreach (var f in t.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static))
                    {
                        if (!typeof(IEnumerable).IsAssignableFrom(f.FieldType) || f.FieldType == typeof(string)) continue;
                        object list;
                        try { list = f.GetValue(null); } catch { continue; }
                        if (!(list is IEnumerable items)) continue;
                        foreach (var item in items) Take(found, item, wanted);
                    }
                }
            }
            return found;
        }

        /// <summary>Add a candidate if it is, or can be turned into, the kind of thing the
        /// save's collection holds. Anything else is skipped in silence: a save is not the
        /// place to find out that a guess was the wrong type.</summary>
        private static void Take(List<object> into, object candidate, Type wanted)
        {
            if (candidate == null) return;
            object value = candidate;
            if (wanted != null && !wanted.IsInstanceOfType(value))
            {
                if (wanted == typeof(string)) value = candidate.ToString();
                else if (wanted.IsEnum && candidate is string s)
                {
                    try { value = Enum.Parse(wanted, s, true); } catch { return; }
                }
                else if (Reflect.IsNumeric(wanted) && candidate is Enum)
                {
                    try { value = Convert.ChangeType(candidate, wanted); } catch { return; }
                }
                else return;
            }
            foreach (var have in into) if (Equals(have, value)) return;
            into.Add(value);
        }

        private void Unlock()
        {
            var set = Current();
            if (set == null) { Notifier.Warn("No run is loaded."); return; }
            if (!(set is IList list))
            {
                Notifier.Warn($"SaveData.{GameBridge.SdCosmetics.Field.Name} is a "
                            + $"{set.GetType().Name}, which this cannot add to. "
                            + "Send the startup report and it can be taught the shape.");
                return;
            }

            if (_before == null)
            {
                _before = new List<object>();
                foreach (var item in list) _before.Add(item);
            }

            Type element = null;
            var t = set.GetType();
            if (t.IsGenericType) element = t.GetGenericArguments()[0];
            else if (t.IsArray) element = t.GetElementType();

            var all = Catalogue(element);
            if (all.Count == 0)
            {
                Notifier.Warn("Could not find the game's cosmetic catalogue on this build. "
                            + "Nothing was written — a list of made-up ids unlocks nothing "
                            + "and is indistinguishable from one that works.");
                return;
            }

            int added = 0;
            foreach (var id in all)
            {
                bool have = false;
                foreach (var item in list) if (Equals(item, id)) { have = true; break; }
                if (have) continue;
                try { list.Add(id); added++; }
                catch (Exception ex) { Notifier.Error($"Could not add a cosmetic: {ex.Message}"); return; }
            }

            Notifier.Success(added == 0
                ? $"Already had all {all.Count} of them."
                : $"Unlocked {added} cosmetic{(added == 1 ? "" : "s")}, from a catalogue of {all.Count}.");
        }

        private void Restore()
        {
            if (_before == null) { Notifier.Warn("Nothing to put back — this has not unlocked anything yet."); return; }
            var set = Current();
            if (!(set is IList list)) { Notifier.Warn("No run is loaded."); return; }
            try
            {
                list.Clear();
                foreach (var item in _before) list.Add(item);
            }
            catch (Exception ex) { Notifier.Error($"Could not restore the set: {ex.Message}"); return; }
            Notifier.Success($"Put back to the {_before.Count} you started with.");
        }
    }
}
