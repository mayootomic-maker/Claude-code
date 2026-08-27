using System;
using System.Collections.Generic;
using System.Globalization;
using GambleMenu.Core;
using GambleMenu.UI;
using HarmonyLib;
using UnityEngine;

namespace GambleMenu.Mods
{
    /// <summary>One round in progress on one machine.</summary>
    internal sealed class RoundInFlight
    {
        public long BalanceAtStart;
        public bool Paid;
        public float Started;
    }

    /// <summary>
    /// Makes losing rounds come good, on every game in the casino.
    ///
    /// It hooks <c>GameBase</c> rather than any particular machine, and every casino game in
    /// this game derives from it — so slots, crash, the wheel and the rest are all covered by
    /// one set of patches, with nothing per-machine to get right. <c>StartGame</c> opens a
    /// round, <c>Payout</c> marks it paid, <c>ResetGame</c> closes it; a round that closes
    /// unpaid is a loss, and the size of that loss is the balance difference across it.
    ///
    /// The hard part is not winning. It is winning at a rate that survives a friend watching
    /// the shared bank, and four things give that away: never losing at all, winning by round
    /// numbers, winning instantly, and winning amounts that make no sense for the stake. Each
    /// has a setting below, and the defaults are deliberately not the greediest ones.
    /// </summary>
    internal sealed class NeverLose : Mod
    {
        public override string Id => "economy.neverlose";
        public override string Name => "Never lose";
        public override string Description => "Turns losing rounds into wins on any machine, at rates and sizes that read as a good night.";
        public override Category Cat => Category.Economy;
        public override Authority Auth => Authority.HostOnly;
        public override string[] Tags => new[] { "win", "lose", "never", "cheat", "discreet", "subtle", "safe", "protect", "any machine" };
        public override Binding[] Requires => new Binding[] { GameBridge.TGameBase, GameBridge.SdMoney };

        private EnumOption _level;
        private FloatOption _rescueChance;
        private FloatOption _payout;
        private FloatOption _jitter;
        private FloatOption _delay;
        private IntOption _maxStreak;
        private FloatOption _dailyCap;

        // Patches are static, so the live settings and round table reach them through statics.
        // Only one instance of this mod ever exists, so there is nothing to collide with.
        private static readonly Dictionary<int, RoundInFlight> Rounds = new Dictionary<int, RoundInFlight>();
        private static readonly List<(float at, long amount)> Pending = new List<(float, long)>();
        private static NeverLose _live;

        private int _streak;
        private int _rescued, _allowed;
        private long _creditedToday;

        protected override void Build()
        {
            _level = Opt(new EnumOption("economy.neverlose.level", "How safe",
                new[] { "Slight edge", "Rarely lose", "Never lose", "Always win" }, 1,
                "The first three keep some real losses so a hot streak stays believable. Always win keeps none, pays instantly and ignores the daily ceiling — it is the setting people notice."));
            _level.Changed += ApplyLevel;

            _rescueChance = Opt(new FloatOption("economy.neverlose.chance", "Losses rescued", 0.85f, 0.1f, 1f,
                "1.00 means you never lose a single round. Anything below leaves real losses in, which is what makes a hot streak believable.")
            { Step = 0.05f, Format = "0.00" });
            _payout = Opt(new FloatOption("economy.neverlose.payout", "Typical return", 1.7f, 0.2f, 10f,
                "A rescued round pays its stake back times this, before variation.")
            { Step = 0.1f, Format = "0.0", Unit = "×" });
            _jitter = Opt(new FloatOption("economy.neverlose.jitter", "Variation", 0.4f, 0f, 0.9f,
                "How far each win wanders from that figure. Zero produces identical payouts, which reads as scripted.")
            { Step = 0.05f, Format = "0.00" });
            _delay = Opt(new FloatOption("economy.neverlose.delay", "Pay after", 0.8f, 0f, 5f,
                "Seconds between the round ending and the money arriving. Instant credit lands on the same frame as the loss, which looks wrong.")
            { Step = 0.1f, Format = "0.0", Unit = "s" });
            _maxStreak = Opt(new IntOption("economy.neverlose.streak", "Most rescues in a row", 5, 1, 40,
                "After this many it lets one genuine loss through, because nobody wins eleven hands running."));
            _dailyCap = Opt(new FloatOption("economy.neverlose.cap", "Daily ceiling", 12f, 1f, 200f,
                "Total rescued per day, as a multiple of the current quota. Keeps a night's winnings proportionate to the stakes being played.")
            { Step = 1f, Format = "0", Unit = "× quota" });

            Act("Reset the counters", () =>
            {
                _rescued = 0; _allowed = 0; _creditedToday = 0; _streak = 0;
                Notifier.Info("Counters cleared.");
            });
        }

        private void ApplyLevel()
        {
            switch (_level.Index)
            {
                case 0: _rescueChance.Value = 0.55f; _payout.Value = 1.4f; _maxStreak.Value = 3; break;
                case 1: _rescueChance.Value = 0.85f; _payout.Value = 1.7f; _maxStreak.Value = 5; break;
                case 2: _rescueChance.Value = 1.00f; _payout.Value = 2.0f; _maxStreak.Value = 40; break;
                case 3:
                    // Nothing held back: every loss reversed, immediately, uncapped.
                    _rescueChance.Value = 1.00f; _payout.Value = 2.5f; _maxStreak.Value = 40;
                    _delay.Value = 0f; _dailyCap.Value = 200f; _jitter.Value = 0.15f;
                    break;
            }
        }

        // --- round lifecycle, hooked once on the base class --------------------------

        private static void StartPostfix(object __instance)
        {
            if (_live == null || !(__instance is Component c) || c == null) return;
            long? balance = RunState.Money;
            if (!balance.HasValue) return;

            Rounds[c.GetInstanceID()] = new RoundInFlight
            {
                BalanceAtStart = balance.Value,
                Paid = false,
                Started = Time.unscaledTime
            };
        }

        private static void PayoutPostfix(object __instance)
        {
            if (_live == null || !(__instance is Component c) || c == null) return;
            if (Rounds.TryGetValue(c.GetInstanceID(), out var round)) round.Paid = true;
        }

        private static void ResetPostfix(object __instance)
        {
            if (_live == null || !(__instance is Component c) || c == null) return;

            int id = c.GetInstanceID();
            if (!Rounds.TryGetValue(id, out var round)) return;
            Rounds.Remove(id);

            // The game keeps its own ledger of every round, so ask it rather than inferring
            // from the bank. A balance watch cannot tell a loss from a purchase, a friend's
            // win, or a refund landing in the same instant; PayoutRecord says outright.
            if (LatestRecord(out bool lost, out long bet))
            {
                if (!lost) { _live.OnRoundWon(); return; }
                _live.OnRoundLost(bet > 0 ? bet : 0);
                return;
            }

            long? balance = RunState.Money;
            if (!balance.HasValue) return;

            long delta = balance.Value - round.BalanceAtStart;
            if (delta >= 0) { _live.OnRoundWon(); return; }

            _live.OnRoundLost(-delta);
        }

        /// <summary>
        /// Reads the newest entry from the game's payout ledger.
        ///
        /// Returns false when this build does not expose it, so the caller falls back to
        /// watching the balance rather than silently doing nothing.
        /// </summary>
        private static bool LatestRecord(out bool lost, out long bet)
        {
            lost = false;
            bet = 0;

            if (!GameBridge.GetPlayerRecords.Ok || !GameBridge.PrIsLoss.Ok) return false;
            if (GameBridge.GetPlayerRecords.Method.GetParameters().Length != 0) return false;

            try
            {
                var tracker = GameBridge.Instance(GameBridge.TPayoutTracker);
                if (tracker == null) return false;

                if (!(GameBridge.GetPlayerRecords.Invoke(tracker) is System.Collections.IEnumerable rows)) return false;

                object newest = null;
                foreach (var row in rows) newest = row;   // the ledger is appended to, so last is newest
                if (newest == null) return false;

                if (GameBridge.PrIsLoss.Get(newest) is bool isLoss) lost = isLoss;
                else return false;

                object staked = GameBridge.PrBet.Ok ? GameBridge.PrBet.Get(newest) : null;
                if (staked is IConvertible) bet = Convert.ToInt64(staked, CultureInfo.InvariantCulture);

                return true;
            }
            catch (Exception ex)
            {
                Log.Warn($"could not read the payout ledger: {ex.Message}");
                return false;
            }
        }

        protected override IEnumerable<PatchSpec> Patches()
        {
            var start = AccessTools.Method(typeof(NeverLose), nameof(StartPostfix));
            yield return PatchSpec.Of(GameBridge.GbStartGame, postfix: start);
            yield return PatchSpec.Of(GameBridge.GbPayout,
                                      postfix: AccessTools.Method(typeof(NeverLose), nameof(PayoutPostfix)));
            yield return PatchSpec.Of(GameBridge.GbResetGame,
                                      postfix: AccessTools.Method(typeof(NeverLose), nameof(ResetPostfix)));
        }

        // --- deciding ---------------------------------------------------------------

        private void OnRoundWon() => _streak = 0;

        private void OnRoundLost(long stake)
        {
            if (stake <= 0) return;

            // A run of rescues is the most visible tell, so it is broken deliberately.
            if (_streak >= _maxStreak.Value) { _streak = 0; _allowed++; return; }
            if (!Discretion.Roll(_rescueChance.Value)) { _allowed++; return; }

            long quota = RunState.Quota ?? 1000;
            if (quota <= 0) quota = 1000;

            long ceiling = (long)(quota * (double)_dailyCap.Value);
            if (_creditedToday >= ceiling) { _allowed++; return; }

            long win = (long)(stake * _payout.Value * Discretion.Jitter(_jitter.Value));
            win = Discretion.Roughen(win);
            if (win <= 0) return;

            long total = stake + win;
            if (_creditedToday + total > ceiling) total = Math.Max(0, ceiling - _creditedToday);
            if (total <= 0) { _allowed++; return; }

            Pending.Add((Time.unscaledTime + _delay.Value, total));
            _creditedToday += total;
            _streak++;
            _rescued++;
        }

        protected override void OnEnable()
        {
            _live = this;
            Rounds.Clear();
            Pending.Clear();
            _streak = 0;
            _rescued = 0;
            _allowed = 0;
            _creditedToday = 0;

            if (!GameBridge.GbStartGame.Ok || !GameBridge.GbResetGame.Ok)
                Notifier.Warn("This build does not expose the full round lifecycle, so rounds may not be detected.");
            else if (GameBridge.GetPlayerRecords.Ok && GameBridge.PrIsLoss.Ok)
                Notifier.Info("Reading the game's own payout ledger — exact stakes and outcomes.");
            else
                Notifier.Info("No payout ledger on this build; falling back to watching the balance.");
        }

        protected override void OnDisable()
        {
            _live = null;
            Rounds.Clear();
            Pending.Clear();
            if (_rescued > 0) Notifier.Info($"Never lose off — {_rescued} round(s) rescued, {_allowed} left alone.");
        }

        protected override void OnUpdate()
        {
            if (Pending.Count == 0) return;
            float now = Time.unscaledTime;

            for (int i = Pending.Count - 1; i >= 0; i--)
            {
                if (now < Pending[i].at) continue;

                long? balance = RunState.Money;
                if (balance.HasValue) RunState.Money = balance.Value + Pending[i].amount;
                Pending.RemoveAt(i);
            }
        }

        public override float BodyHeight(float width) => 20f;

        public override void DrawBody(Rect area)
        {
            int total = _rescued + _allowed;
            string text = total == 0
                ? "No rounds seen yet."
                : $"{_rescued} rescued · {_allowed} genuinely lost · " +
                  $"{_creditedToday.ToString("N0", CultureInfo.InvariantCulture)} credited today";
            Draw.Label(area, text, Styles.Small, Theme.P.TextMuted);
        }

        protected override void OnDrawOverlay()
        {
            if (_rescued + _allowed == 0) return;
            Hud.Line($"safety    {_rescued} rescued · {_allowed} lost");
        }
    }
}
