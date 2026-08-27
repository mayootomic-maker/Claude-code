using System;
using GambleMenu.Core;
using UnityEngine;

namespace GambleMenu.Mods
{
    /// <summary>
    /// Shapes a credit so it reads as a run of good luck rather than an edit.
    ///
    /// Three things give a blunt money mod away to anyone watching the shared balance: the
    /// numbers are round, the size is wrong for the stakes being played, and the timing is
    /// instant. This fixes all three — jitter kills round numbers, scaling against the current
    /// quota keeps the size proportionate to where the run actually is, and the callers below
    /// spread payments over time instead of applying them in one frame.
    ///
    /// It is worth being straight about the ceiling: this changes how plausible a change
    /// looks, not whether the change is visible. Anyone reading the bank still sees the number
    /// move. What they will not see is a suspiciously round trillion appearing between frames.
    /// </summary>
    internal static class Discretion
    {
        /// <summary>Deterministic per-call variation. UnityEngine.Random is deliberately not
        /// used: the game draws from it too, and consuming values from the shared sequence
        /// would perturb the very outcomes the player is gambling on.</summary>
        private static readonly System.Random Rng = new System.Random(unchecked(Environment.TickCount * 397));

        public static float Jitter(float amount)
        {
            double t = Rng.NextDouble() * 2.0 - 1.0;   // -1 … 1
            return 1f + (float)t * amount;
        }

        public static bool Roll(float probability) => Rng.NextDouble() < probability;

        /// <summary>
        /// Rounds a value off its round number.
        ///
        /// A credit of exactly 50 000 reads as typed; 49 380 reads as a payout. The nudge is
        /// proportional so it survives at any scale.
        /// </summary>
        public static long Roughen(long value)
        {
            if (value == 0) return 0;
            long magnitude = Math.Abs(value);
            long grain = magnitude >= 1_000_000 ? magnitude / 1000
                       : magnitude >= 10_000 ? magnitude / 200
                       : 1;
            if (grain <= 1) return value;
            long offset = (long)((Rng.NextDouble() * 2.0 - 1.0) * grain);
            return value + offset;
        }

        /// <summary>
        /// The largest single credit that still looks like a plausible win.
        ///
        /// Anchored to the day's quota, because that is what the game itself scales to: a
        /// payout worth a few times the current demand is a good night, and one worth ten
        /// thousand times it is a confession.
        /// </summary>
        public static long PlausibleCeiling(float multipleOfQuota)
        {
            long quota = RunState.Quota ?? 0;
            if (quota <= 0) quota = 1000;
            double ceiling = quota * (double)multipleOfQuota;
            return ceiling >= long.MaxValue / 4 ? long.MaxValue / 4 : (long)ceiling;
        }
    }

    /// <summary>
    /// Turns some losses into wins, at sizes the game itself would produce.
    ///
    /// This is the subtle counterpart to the pinned balance: nothing is set, nothing jumps,
    /// and the bank only ever moves by amounts a real payout could have produced. From the
    /// outside it is a hot streak.
    /// </summary>
    internal sealed class LuckyStreak : BalanceWatcher
    {
        public override string Id => "discreet.lucky";
        public override string Name => "Lucky streak";
        public override string Description => "Quietly turns some losses into wins, at believable sizes. Looks like variance, not an edit.";
        public override Category Cat => Category.Economy;
        public override Authority Auth => Authority.HostOnly;
        public override string[] Tags => new[] { "luck", "subtle", "discreet", "hidden", "natural", "streak", "undetectable", "win" };
        public override Binding[] Requires => new Binding[] { GameBridge.SdMoney };

        private FloatOption _chance;
        private FloatOption _payout;
        private FloatOption _jitter;
        private IntOption _maxStreak;
        private FloatOption _cooldown;

        private int _streak;
        private float _readyAt;

        protected override void Build()
        {
            _chance = Opt(new FloatOption("discreet.lucky.chance", "Loss becomes a win", 0.5f, 0.05f, 1f,
                "1.00 means you never lose, which is exactly what gives it away. Around half looks like a good night.")
            { Step = 0.05f, Format = "0.00" });
            _payout = Opt(new FloatOption("discreet.lucky.payout", "Typical payout", 1.8f, 0.2f, 12f,
                "A converted loss pays back its stake times this, before jitter.")
            { Step = 0.1f, Format = "0.0", Unit = "×" });
            _jitter = Opt(new FloatOption("discreet.lucky.jitter", "Variation", 0.35f, 0f, 0.9f,
                "How much each payout wanders from the figure above. Zero produces identical wins, which reads as scripted.")
            { Step = 0.05f, Format = "0.00" });
            _maxStreak = Opt(new IntOption("discreet.lucky.streak", "Most wins in a row", 4, 1, 20,
                "After this many rescued losses it lets one through, because nobody wins nine hands running."));
            _cooldown = Opt(new FloatOption("discreet.lucky.cooldown", "Rest after a win", 1.5f, 0f, 20f,
                "Seconds before it will rescue another loss.") { Step = 0.5f, Format = "0.0", Unit = "s" });
        }

        protected override void OnEnable()
        {
            base.OnEnable();
            _streak = 0;
            _readyAt = 0f;
        }

        protected override long OnBalanceChanged(long delta, long balance)
        {
            if (delta >= 0) { _streak = 0; return balance; }       // a genuine win resets the run
            if (Time.unscaledTime < _readyAt) return balance;
            if (_streak >= _maxStreak.Value) { _streak = 0; return balance; }
            if (!Discretion.Roll(_chance.Value)) return balance;

            long stake = -delta;
            long win = (long)(stake * _payout.Value * Discretion.Jitter(_jitter.Value));
            win = Discretion.Roughen(win);

            long ceiling = Discretion.PlausibleCeiling(50f);
            if (win > ceiling) win = ceiling;
            if (win <= 0) return balance;

            _streak++;
            _readyAt = Time.unscaledTime + _cooldown.Value;

            // Refund the stake, then pay the win on top — the shape a real payout has.
            return balance + stake + win;
        }
    }

    /// <summary>
    /// Walks the balance toward a target instead of setting it.
    ///
    /// The pinned balance mod is instant and obvious by design. This is the same intent
    /// served slowly: money arrives in payout-sized pieces at irregular intervals, so an
    /// evening's grind produces the number you wanted without a single visible jump.
    /// </summary>
    internal sealed class DripFeed : Mod
    {
        public override string Id => "discreet.drip";
        public override string Name => "Slow drip";
        public override string Description => "Walks the bank toward a target in believable steps rather than setting it outright.";
        public override Category Cat => Category.Economy;
        public override Authority Auth => Authority.HostOnly;
        public override string[] Tags => new[] { "subtle", "discreet", "gradual", "slow", "natural", "hidden", "drip" };
        public override Binding[] Requires => new Binding[] { GameBridge.SdMoney };

        private LongOption _target;
        private FloatOption _perMinute;
        private FloatOption _interval;
        private FloatOption _jitter;
        private BoolOption _onlyWhenLow;

        private float _nextPayment;

        protected override void Build()
        {
            _target = Opt(new LongOption("discreet.drip.target", "Aim for", 5_000_000L, 0L, long.MaxValue / 4,
                "It stops once the bank reaches this.")
            { Presets = new[] { 100_000L, 5_000_000L, 1_000_000_000L } });
            _perMinute = Opt(new FloatOption("discreet.drip.rate", "Quotas per minute", 1f, 0.05f, 20f,
                "Income rate, measured against the current quota so it stays proportionate as the run scales.")
            { Step = 0.05f, Format = "0.00" });
            _interval = Opt(new FloatOption("discreet.drip.interval", "Payment every", 12f, 2f, 120f,
                "Larger gaps look more like real wins and less like a trickle.") { Step = 1f, Format = "0", Unit = "s" });
            _jitter = Opt(new FloatOption("discreet.drip.jitter", "Variation", 0.4f, 0f, 0.9f)
            { Step = 0.05f, Format = "0.00" });
            _onlyWhenLow = Opt(new BoolOption("discreet.drip.low", "Only while below the quota", false,
                "Tops you up when you are short and stays out of the way otherwise."));
        }

        protected override void OnEnable() => _nextPayment = Time.unscaledTime + _interval.Value;

        protected override void OnUpdate()
        {
            long? balance = RunState.Money;
            if (!balance.HasValue) return;
            if (balance.Value >= _target.Value) return;

            if (_onlyWhenLow.Value)
            {
                long quota = RunState.Quota ?? 0;
                if (quota > 0 && balance.Value >= quota) return;
            }

            if (Time.unscaledTime < _nextPayment) return;
            // The gap itself wanders, or payments land on a metronome.
            _nextPayment = Time.unscaledTime + _interval.Value * Discretion.Jitter(0.3f);

            long quotaNow = RunState.Quota ?? 1000;
            if (quotaNow <= 0) quotaNow = 1000;

            double perSecond = quotaNow * (double)_perMinute.Value / 60.0;
            long payment = (long)(perSecond * _interval.Value * Discretion.Jitter(_jitter.Value));
            payment = Discretion.Roughen(payment);
            if (payment <= 0) return;

            long next = balance.Value + payment;
            if (next > _target.Value) next = _target.Value;
            RunState.Money = next;
        }
    }
}
