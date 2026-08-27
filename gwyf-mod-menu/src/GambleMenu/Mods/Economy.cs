using System.Collections.Generic;
using System.Globalization;
using GambleMenu.Core;
using HarmonyLib;

namespace GambleMenu.Mods
{
    /// <summary>
    /// Watches the shared balance and reports frame-to-frame changes.
    ///
    /// The game's payout method is not a known binding, so multiplying winnings by patching
    /// it is not on the table. Watching the balance instead works against any payout path the
    /// game has — slots, crash, an item sale — because it reacts to the result rather than
    /// the cause. The cost is honesty about scope: it cannot tell a jackpot from a refund,
    /// which is why the mods below say so in their own descriptions.
    /// </summary>
    internal abstract class BalanceWatcher : Mod
    {
        private long _last;
        private bool _primed;

        protected override void OnEnable()
        {
            // Deliberately not primed here: the first observed balance becomes the baseline,
            // so switching a watcher on mid-spin cannot mistake the spin already in flight
            // for a change it caused.
            _primed = false;
        }

        protected override void OnUpdate()
        {
            long? current = RunState.Money;
            if (!current.HasValue) { _primed = false; return; }

            if (!_primed)
            {
                _last = current.Value;
                _primed = true;
                return;
            }

            long delta = current.Value - _last;
            _last = current.Value;
            if (delta == 0) return;

            long adjusted = OnBalanceChanged(delta, current.Value);
            if (adjusted == current.Value) return;

            RunState.Money = adjusted;
            _last = adjusted;
        }

        /// <summary>Returns the balance that should stand after this change.</summary>
        protected abstract long OnBalanceChanged(long delta, long balance);
    }

    internal sealed class WinningsMultiplier : BalanceWatcher
    {
        public override string Id => "economy.winmult";
        public override string Name => "Winnings multiplier";
        public override string Description => "Tops up every gain so it lands multiplied. Applies to any income, not only wins.";
        public override Category Cat => Category.Economy;
        public override Authority Auth => Authority.HostOnly;
        public override string[] Tags => new[] { "money", "payout", "multiplier", "gain" };
        public override Binding[] Requires => new Binding[] { GameBridge.SdMoney };

        private FloatOption _mult;
        private BoolOption _lossesToo;

        protected override void Build()
        {
            _mult = Opt(new FloatOption("economy.winmult.x", "Multiplier", 2f, 1f, 100f,
                "A win of 100 at 3× becomes 300.") { Step = 0.5f, Format = "0.#", Unit = "×" });
            _lossesToo = Opt(new BoolOption("economy.winmult.losses", "Multiply losses too", false,
                "Off keeps losses at face value, so this is purely favourable."));
        }

        protected override long OnBalanceChanged(long delta, long balance)
        {
            if (delta < 0 && !_lossesToo.Value) return balance;
            long extra = (long)(delta * (_mult.Value - 1f));
            return balance + extra;
        }
    }

    internal sealed class LossProtection : BalanceWatcher
    {
        public override string Id => "economy.lossguard";
        public override string Name => "Loss protection";
        public override string Description => "Refunds losses, either partly or in full, the moment they land.";
        public override Category Cat => Category.Economy;
        public override Authority Auth => Authority.HostOnly;
        public override string[] Tags => new[] { "money", "refund", "insurance", "safety" };
        public override Binding[] Requires => new Binding[] { GameBridge.SdMoney };

        private FloatOption _refund;

        protected override void Build()
        {
            _refund = Opt(new FloatOption("economy.lossguard.pct", "Refunded", 1f, 0f, 1f,
                "1.00 gives every lost chip back; 0.50 halves the damage.") { Step = 0.05f, Format = "0.00" });
        }

        protected override long OnBalanceChanged(long delta, long balance)
        {
            if (delta >= 0) return balance;
            long refund = (long)(-delta * _refund.Value);
            return balance + refund;
        }
    }

    internal sealed class BalanceFloor : Mod
    {
        public override string Id => "economy.floor";
        public override string Name => "Minimum balance";
        public override string Description => "Keeps the bank from ever dropping below a number you set.";
        public override Category Cat => Category.Economy;
        public override Authority Auth => Authority.HostOnly;
        public override string[] Tags => new[] { "money", "floor", "minimum", "never broke" };
        public override Binding[] Requires => new Binding[] { GameBridge.SdMoney };

        private LongOption _floor;

        protected override void Build()
        {
            _floor = Opt(new LongOption("economy.floor.value", "Never below", 10_000L, 0L, long.MaxValue / 4,
                "Checked every frame while this is on.")
            { Presets = new[] { 1_000L, 100_000L, 10_000_000L } });
        }

        protected override void OnUpdate()
        {
            long? money = RunState.Money;
            if (money.HasValue && money.Value < _floor.Value) RunState.Money = _floor.Value;
        }
    }

    internal sealed class InfiniteMoney : Mod
    {
        public override string Id => "economy.infinite";
        public override string Name => "Pinned balance";
        public override string Description => "Holds the bank at a fixed number, so nothing you spend ever moves it.";
        public override Category Cat => Category.Economy;
        public override Authority Auth => Authority.HostOnly;
        public override string[] Tags => new[] { "money", "infinite", "unlimited", "rich" };
        public override Binding[] Requires => new Binding[] { GameBridge.SdMoney };

        private LongOption _target;

        protected override void Build()
        {
            _target = Opt(new LongOption("economy.infinite.value", "Hold at", 1_000_000_000_000L, 0L, long.MaxValue / 4,
                "A trillion is what the game's own sandbox saves start with.")
            { Presets = new[] { 1_000_000L, 1_000_000_000L, 1_000_000_000_000L } });
        }

        protected override void OnUpdate()
        {
            long? money = RunState.Money;
            if (money.HasValue && money.Value != _target.Value) RunState.Money = _target.Value;
        }
    }

    /// <summary>One-shot balance edits. A button, not a switch, because these are events.</summary>
    internal sealed class BalanceEditor : Mod
    {
        public override string Id => "economy.editor";
        public override string Name => "Adjust balance";
        public override string Description => "Set, add to or clear the shared bank account once.";
        public override Category Cat => Category.Economy;
        public override Authority Auth => Authority.HostOnly;
        public override bool IsToggle => false;
        public override string[] Tags => new[] { "money", "give", "add", "set", "cash" };
        public override Binding[] Requires => new Binding[] { GameBridge.SdMoney };

        private LongOption _amount;

        protected override void Build()
        {
            _amount = Opt(new LongOption("economy.editor.amount", "Amount", 1_000_000L, long.MinValue / 4, long.MaxValue / 4)
            { Presets = new[] { 10_000L, 1_000_000L, 1_000_000_000L } });

            Act("Set to amount", () => Apply(_ => _amount.Value), "Replaces the balance outright.");
            Act("Add amount", () => Apply(current => current + _amount.Value), "Adds to whatever is there now.");
            Act("Double it", () => Apply(current => current * 2), "Doubles the current balance.");
            Act("Clear to zero", () => Apply(_ => 0L), "Sets the bank to nothing.", destructive: true);
        }

        private void Apply(System.Func<long, long> change)
        {
            long? current = RunState.Money;
            if (!current.HasValue)
            {
                Notifier.Warn("No run is loaded — start or load a save first.");
                return;
            }
            long next = change(current.Value);
            RunState.Money = next;
            Notifier.Success($"Balance set to {next.ToString("N0", CultureInfo.InvariantCulture)}.");
        }
    }

    /// <summary>
    /// Pins the loan shark's demand by short-circuiting the quota calculation.
    ///
    /// This is the one economy hook with a named binding behind it rather than a value watch,
    /// so it stops the ramp at the source instead of correcting it afterwards.
    /// </summary>
    internal sealed class QuotaFreeze : Mod
    {
        public override string Id => "economy.quotafreeze";
        public override string Name => "Freeze quota";
        public override string Description => "Stops the daily demand from ramping and holds it at your number.";
        public override Category Cat => Category.Economy;
        public override Authority Auth => Authority.HostOnly;
        public override string[] Tags => new[] { "quota", "debt", "loan shark", "demand" };
        public override Binding[] Requires => new Binding[] { GameBridge.GetQuota };

        // Harmony patches are static, so the live value reaches the prefix through a static.
        // Only one instance of this mod is ever registered, so there is nothing to collide with.
        private static long _frozenAt;
        private static bool _active;

        private LongOption _value;

        protected override void Build()
        {
            _value = Opt(new LongOption("economy.quotafreeze.value", "Hold quota at", 1_000L, 0L, long.MaxValue / 4,
                "Every day will ask for exactly this.")
            { Presets = new[] { 0L, 1_000L, 100_000L } });
            _value.Changed += () => _frozenAt = _value.Value;
        }

        protected override void OnEnable()
        {
            _frozenAt = _value.Value;
            _active = true;
        }

        protected override void OnDisable() => _active = false;

        private static bool Prefix(ref long __result)
        {
            if (!_active) return true;   // fall through to the game's own calculation
            __result = _frozenAt;
            return false;
        }

        protected override IEnumerable<PatchSpec> Patches()
        {
            yield return PatchSpec.Of(GameBridge.GetQuota,
                                      prefix: AccessTools.Method(typeof(QuotaFreeze), nameof(Prefix)));
        }
    }

    internal sealed class QuotaEditor : Mod
    {
        public override string Id => "economy.quotaedit";
        public override string Name => "Adjust quota";
        public override string Description => "Change today's demand, or mark it already met.";
        public override Category Cat => Category.Economy;
        public override Authority Auth => Authority.HostOnly;
        public override bool IsToggle => false;
        public override string[] Tags => new[] { "quota", "debt", "pay", "meet" };
        public override Binding[] Requires => new Binding[] { GameBridge.SdCurrentQuota };

        private LongOption _amount;

        protected override void Build()
        {
            _amount = Opt(new LongOption("economy.quotaedit.amount", "Quota", 0L, 0L, long.MaxValue / 4)
            { Presets = new[] { 0L, 1_000L, 1_000_000L } });

            Act("Set quota", () =>
            {
                if (!RunState.Available) { Notifier.Warn("No run is loaded."); return; }
                RunState.Quota = _amount.Value;
                Notifier.Success($"Quota set to {_amount.Value.ToString("N0", CultureInfo.InvariantCulture)}.");
            }, "Writes today's demand.");

            Act("Cover it from the bank", () =>
            {
                long? quota = RunState.Quota;
                long? money = RunState.Money;
                if (!quota.HasValue || !money.HasValue) { Notifier.Warn("No run is loaded."); return; }
                if (money.Value >= quota.Value) { Notifier.Info("The bank already covers today's quota."); return; }
                RunState.Money = quota.Value;
                Notifier.Success("Bank topped up to exactly today's quota.");
            }, "Raises the balance to today's demand and no further.");
        }
    }
}
