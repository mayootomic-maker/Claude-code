using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using GambleMenu.Core;
using HarmonyLib;
using UnityEngine;
using Object = UnityEngine.Object;

namespace GambleMenu.Mods
{
    /// <summary>
    /// New objectives, written into the game's own challenge table.
    ///
    /// This is the one place the game can be given genuinely new content without shipping an
    /// asset bundle. Challenges are ScriptableObjects on a <c>ChallengeSettings</c> asset that
    /// <c>ChallengeManager</c> loads from Resources; the conditions they are built from are
    /// plain serialisable classes. So a challenge made at runtime out of the game's own
    /// condition types is indistinguishable from one the developers shipped — same board, same
    /// progress text, same ticket reward, same UI.
    ///
    /// Nothing here invents a mechanic. Every objective below is a combination of conditions
    /// the game already evaluates, which is why they read as native rather than as a mod.
    ///
    /// Both sides need this installed for it to be seen. The manager syncs a challenge by its
    /// id and each client looks that id up in its own copy of the table, so an id only the host
    /// knows about resolves to nothing on a friend's screen. The rewards are still the host's
    /// to grant, hence host-only.
    /// </summary>
    internal sealed class ChallengePack : Mod
    {
        public override string Id => "content.challenges";
        public override string Name => "Extra challenges";
        public override string Description =>
            "Adds new objectives to the game's own challenge board, built from the conditions it already understands.";
        public override Category Cat => Category.Progression;
        public override Authority Auth => Authority.HostOnly;
        public override string[] Tags => new[] { "challenge", "objective", "content", "tickets", "expansion" };

        public override Binding[] Requires => new Binding[]
        {
            GameBridge.TChallengeSettings, GameBridge.TChallenge, GameBridge.ChallengeList,
            GameBridge.TCasinoGameType,
        };

        /// <summary>
        /// Ids start high on purpose. The game identifies a challenge by this number over the
        /// network and in the save file, so colliding with a shipped one would silently
        /// overwrite a real objective's progress rather than add anything.
        /// </summary>
        private const int IdBase = 90_000;

        private readonly List<object> _injected = new List<object>();

        // --- the content -----------------------------------------------------------

        /// <summary>One authored objective. Conditions are described rather than constructed
        /// here so the table stays readable as a list of designs.</summary>
        private sealed class Design
        {
            public string Name;
            public string Description;
            public int Floor;
            public int Tickets;
            public bool Repeatable;
            public Action<ChallengePack, IList> Conditions;
        }

        private static readonly Design[] Designs =
        {
            new Design
            {
                Name = "Cold Open", Description = "Win three rounds in a row.",
                Floor = 0, Tickets = 3, Repeatable = true,
                Conditions = (p, c) => p.AddWins(c, 3, consecutive: true),
            },
            new Design
            {
                Name = "House Money", Description = "Take a payout of five times your stake.",
                Floor = 0, Tickets = 4,
                Conditions = (p, c) => p.AddPayoutMultiplier(c, 5f),
            },
            new Design
            {
                Name = "Nerve", Description = "Stake half the quota on one round — and win it.",
                Floor = 1, Tickets = 6,
                Conditions = (p, c) => { p.AddBetShare(c, 0.5f); p.AddWins(c, 1, consecutive: false); },
            },
            new Design
            {
                Name = "Down But Not Out", Description = "Lose four in a row, then win.",
                Floor = 1, Tickets = 5, Repeatable = true,
                Conditions = (p, c) => { p.AddLosses(c, 4, consecutive: true); p.AddWins(c, 1, consecutive: false); },
            },
            new Design
            {
                Name = "Gravity Well", Description = "Win five rounds of Plinko.",
                Floor = 1, Tickets = 5, Repeatable = true,
                Conditions = (p, c) => { p.AddGameType(c, "Plinko"); p.AddWins(c, 5, consecutive: false); },
            },
            new Design
            {
                Name = "Card Counter", Description = "Win four hands of Blackjack in a row.",
                Floor = 2, Tickets = 7,
                Conditions = (p, c) => { p.AddGameType(c, "Blackjack"); p.AddWins(c, 4, consecutive: true); },
            },
            new Design
            {
                Name = "Clockwork", Description = "Clear a third of the quota in profit inside two minutes.",
                Floor = 2, Tickets = 8,
                Conditions = (p, c) => { p.AddProfitShare(c, 0.33f); p.AddTimeLimit(c, 120f); },
            },
            new Design
            {
                Name = "Cold Iron", Description = "Take a ten-times payout on Roulette.",
                Floor = 2, Tickets = 8,
                Conditions = (p, c) => { p.AddGameType(c, "Roulette"); p.AddPayoutMultiplier(c, 10f); },
            },
            new Design
            {
                Name = "Whale", Description = "Put the entire quota on a single round.",
                Floor = 3, Tickets = 10,
                Conditions = (p, c) => p.AddBetShare(c, 1f),
            },
            new Design
            {
                Name = "Hot Hand", Description = "Win eight rounds in a row.",
                Floor = 3, Tickets = 12,
                Conditions = (p, c) => p.AddWins(c, 8, consecutive: true),
            },
            new Design
            {
                Name = "Terminal Velocity", Description = "Ride Crash to twenty times.",
                Floor = 3, Tickets = 12,
                Conditions = (p, c) => { p.AddGameType(c, "Crash"); p.AddPayoutMultiplier(c, 20f); },
            },
            new Design
            {
                Name = "Margin", Description = "Finish twice the quota up on the day.",
                Floor = 3, Tickets = 14,
                Conditions = (p, c) => p.AddProfitShare(c, 2f),
            },
        };

        // --- lifecycle -------------------------------------------------------------

        protected override void OnEnable()
        {
            // Failure is raised rather than switched off here. Assigning to Enabled inside
            // OnEnable runs Stop() before Start() has set _running, so the stop is skipped and
            // the mod ends up live with its own switch reading off. Throwing goes through the
            // fault latch, which disables it properly and says why.
            var settings = LoadSettings();
            if (settings == null)
                throw new InvalidOperationException("the ChallengeSettings asset could not be loaded on this build");

            var all = GameBridge.ChallengeList.Get(settings) as IList;
            if (all == null)
                throw new InvalidOperationException("ChallengeSettings.challenges is not a list on this build");

            int made = 0;
            for (int i = 0; i < Designs.Length; i++)
            {
                var challenge = Build(Designs[i], IdBase + i);
                if (challenge == null) continue;

                all.Add(challenge);
                AddToFloorList(settings, Designs[i].Floor, challenge);
                _injected.Add(challenge);
                made++;
            }

            // The manager copies the table into its own list when it starts. Enabling this
            // mid-run means that copy has already happened, so it needs the same additions.
            PushToLiveManager();

            if (made == 0) Notifier.Warn("No challenges could be built — see the Compatibility page.");
            else Notifier.Success($"{made} challenge(s) added to the board.");
        }

        protected override void OnDisable()
        {
            var settings = LoadSettings();
            var all = settings == null ? null : GameBridge.ChallengeList.Get(settings) as IList;

            foreach (var challenge in _injected)
            {
                if (all != null && all.Contains(challenge)) all.Remove(challenge);
                RemoveFromFloorLists(settings, challenge);
                RemoveFromLiveManager(challenge);

                // Made with CreateInstance and owned by nothing else, so it leaks unless this
                // takes it down with the mod.
                if (challenge is Object obj) Object.Destroy(obj);
            }
            _injected.Clear();
        }

        // --- building --------------------------------------------------------------

        private object Build(Design design, int id)
        {
            try
            {
                var challenge = ScriptableObject.CreateInstance(GameBridge.TChallenge.Type);
                if (challenge == null) return null;

                Set(challenge, "challengeID", id);
                Set(challenge, "challengeName", design.Name);
                Set(challenge, "description", design.Description);
                Set(challenge, "floorIndex", design.Floor);
                Set(challenge, "manualTicketReward", design.Tickets);
                Set(challenge, "repeatable", design.Repeatable);
                Set(challenge, "requireAllSimultaneously", true);

                var conditions = AccessTools.Field(GameBridge.TChallenge.Type, "conditions")?.GetValue(challenge) as IList;
                if (conditions == null)
                {
                    Log.Warn($"challenge '{design.Name}' has no conditions list — skipped");
                    Object.Destroy(challenge);
                    return null;
                }

                design.Conditions(this, conditions);
                if (conditions.Count == 0)
                {
                    // An objective with no conditions completes instantly and hands out a free
                    // reward, which is worse than not adding it.
                    Log.Warn($"challenge '{design.Name}' resolved no conditions on this build — skipped");
                    Object.Destroy(challenge);
                    return null;
                }
                return challenge;
            }
            catch (Exception ex)
            {
                Log.Error($"challenge '{design.Name}' could not be built: {ex.Message}");
                return null;
            }
        }

        private object NewCondition(TypeBinding type, string description)
        {
            if (!type.Ok) { Log.Warn($"condition {type.Id} is missing on this build"); return null; }
            var condition = Activator.CreateInstance(type.Type);
            Set(condition, "description", description);
            return condition;
        }

        private void AddWins(IList into, int count, bool consecutive)
        {
            var c = NewCondition(GameBridge.TCondWinCount, consecutive ? $"Win {count} in a row" : $"Win {count}");
            if (c == null) return;
            Set(c, "requiredWins", count);
            Set(c, "consecutive", consecutive);
            into.Add(c);
        }

        private void AddLosses(IList into, int count, bool consecutive)
        {
            var c = NewCondition(GameBridge.TCondLossCount, consecutive ? $"Lose {count} in a row" : $"Lose {count}");
            if (c == null) return;
            Set(c, "requiredLosses", count);
            Set(c, "consecutive", consecutive);
            into.Add(c);
        }

        private void AddPayoutMultiplier(IList into, float min)
        {
            var c = NewCondition(GameBridge.TCondPayoutMult, $"Payout of {min:0.#}x or better");
            if (c == null) return;
            Set(c, "minPayoutMultiplier", min);
            into.Add(c);
        }

        private void AddBetShare(IList into, float share)
        {
            var c = NewCondition(GameBridge.TCondBetAmount, $"Stake {share * 100f:0}% of the quota");
            if (c == null) return;
            Set(c, "minBetMultiplier", share);
            into.Add(c);
        }

        private void AddProfitShare(IList into, float share)
        {
            var c = NewCondition(GameBridge.TCondProfit, $"Make {share * 100f:0}% of the quota in profit");
            if (c == null) return;
            Set(c, "minProfitMultiplier", share);
            into.Add(c);
        }

        private void AddTimeLimit(IList into, float seconds)
        {
            var c = NewCondition(GameBridge.TCondTime, $"Within {seconds:0} seconds");
            if (c == null) return;
            Set(c, "timeLimit", seconds);
            into.Add(c);
        }

        /// <summary>Restricts an objective to one game, by the enum name the game uses.</summary>
        private void AddGameType(IList into, string gameTypeName)
        {
            if (!GameBridge.TCasinoGameType.Ok) return;
            object value;
            try { value = Enum.Parse(GameBridge.TCasinoGameType.Type, gameTypeName); }
            catch
            {
                // A game this build does not have. Dropping the filter would silently widen the
                // objective to every game, so the whole challenge is abandoned instead.
                Log.Warn($"this build has no CasinoGameType.{gameTypeName}");
                return;
            }

            var c = NewCondition(GameBridge.TCondGameType, $"On {gameTypeName}");
            if (c == null) return;
            Set(c, "requiredGameType", value);
            into.Add(c);
        }

        // --- the table and the live manager -----------------------------------------

        private static object LoadSettings()
        {
            if (!GameBridge.TChallengeSettings.Ok) return null;
            try { return Resources.Load("ChallengeSettings", GameBridge.TChallengeSettings.Type); }
            catch (Exception ex) { Log.Warn($"could not load ChallengeSettings: {ex.Message}"); return null; }
        }

        private static readonly string[] FloorLists =
        {
            "firstFloorChallenges", "secondFloorChallenges", "thirdFloorChallenges", "fourthFloorChallenges",
        };

        private static void AddToFloorList(object settings, int floor, object challenge)
        {
            if (floor < 0 || floor >= FloorLists.Length) return;
            var list = AccessTools.Field(GameBridge.TChallengeSettings.Type, FloorLists[floor])?.GetValue(settings) as IList;
            list?.Add(challenge);
        }

        private static void RemoveFromFloorLists(object settings, object challenge)
        {
            if (settings == null) return;
            foreach (var name in FloorLists)
            {
                var list = AccessTools.Field(GameBridge.TChallengeSettings.Type, name)?.GetValue(settings) as IList;
                if (list != null && list.Contains(challenge)) list.Remove(challenge);
            }
        }

        private void PushToLiveManager()
        {
            var list = LiveManagerList();
            if (list == null) return;
            foreach (var challenge in _injected)
                if (!list.Contains(challenge)) list.Add(challenge);
        }

        private static void RemoveFromLiveManager(object challenge)
        {
            var list = LiveManagerList();
            if (list != null && list.Contains(challenge)) list.Remove(challenge);
        }

        private static IList LiveManagerList()
        {
            if (!GameBridge.TChallengeManager.Ok) return null;
            var manager = GameBridge.Instance(GameBridge.TChallengeManager);
            if (manager == null) return null;
            return AccessTools.Field(GameBridge.TChallengeManager.Type, "allChallenges")?.GetValue(manager) as IList;
        }

        private static void Set(object target, string field, object value)
        {
            var f = AccessTools.Field(target.GetType(), field);
            if (f == null) { Log.Warn($"{target.GetType().Name}.{field} is missing on this build"); return; }
            try { f.SetValue(target, value); }
            catch (Exception ex) { Log.Warn($"could not set {target.GetType().Name}.{field}: {ex.Message}"); }
        }
    }
}
