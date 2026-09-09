using System.Globalization;
using GambleMenu.Core;

namespace GambleMenu.Mods
{
    internal sealed class FloorAccess : Mod
    {
        public override string Id => "progress.floors";
        public override string Name => "Floor access";
        public override string Description => "Jump to any floor of the tower, or drop the requirement gating the next one.";
        public override Category Cat => Category.Progression;
        public override Authority Auth => Authority.HostOnly;
        public override bool IsToggle => false;
        public override string[] Tags => new[] { "floor", "unlock", "tower", "progress", "elevator" };
        public override Binding[] Requires => new Binding[] { GameBridge.SdCurrentFloor };

        private IntOption _floor;

        protected override void Build()
        {
            _floor = Opt(new IntOption("progress.floors.index", "Floor", 0, 0, 16,
                "Floor 0 is the ground floor. The game ships four themed floors; the real ceiling is read from the game and shown below."));

            Act("Go to top floor", () =>
            {
                int? top = RunState.TopFloor;
                if (!top.HasValue)
                {
                    Notifier.Warn("The floor table is not exposed on this build — set a floor number by hand instead.");
                    return;
                }
                if (!RunState.Available) { Notifier.Warn("No run is loaded."); return; }
                RunState.Floor = top.Value;
                Notifier.Success($"Moved to the top floor ({top.Value}).");
            }, "Reads the real top floor from the game's own floor table.");

            Act("Set to floor number", () =>
            {
                if (!RunState.Available) { Notifier.Warn("No run is loaded."); return; }
                int? top = RunState.TopFloor;
                if (top.HasValue && _floor.Value > top.Value)
                {
                    Notifier.Warn($"This build only has floors 0–{top.Value}; a higher number would point at nothing.");
                    return;
                }
                RunState.Floor = _floor.Value;
                Notifier.Success($"Moved to floor {_floor.Value}.");
            });

            Act("Clear the next-floor requirement", () =>
            {
                if (!GameBridge.SdRequiredQuotaToNextFloor.Ok)
                {
                    Notifier.Warn("This build does not expose the floor requirement.");
                    return;
                }
                if (!RunState.Available) { Notifier.Warn("No run is loaded."); return; }
                RunState.NextFloorRequirement = 0;
                Notifier.Success("Next floor no longer needs a quota.");
            }, "Sets the quota gating the next floor to zero.");
        }

    }

    internal sealed class HoldFloor : Mod
    {
        public override string Id => "progress.holdfloor";
        public override string Name => "Hold current floor";
        public override string Description => "Pins the floor so the run cannot move you off it.";
        public override Category Cat => Category.Progression;
        public override Authority Auth => Authority.HostOnly;
        public override string[] Tags => new[] { "floor", "lock", "hold", "stay" };
        public override Binding[] Requires => new Binding[] { GameBridge.SdCurrentFloor };

        private int _held;
        private bool _captured;

        protected override void OnEnable()
        {
            _captured = false;
        }

        protected override void OnUpdate()
        {
            int? current = RunState.Floor;
            if (!current.HasValue) return;

            if (!_captured)
            {
                _held = current.Value;
                _captured = true;
                Notifier.Info($"Holding floor {_held}.");
                return;
            }
            if (current.Value != _held) RunState.Floor = _held;
        }
    }

    internal sealed class SurvivedDays : Mod
    {
        public override string Id => "progress.days";
        public override string Name => "Days survived";
        public override string Description => "Reads and rewrites the count of quotas you have met.";
        public override Category Cat => Category.Progression;
        public override Authority Auth => Authority.HostOnly;
        public override bool IsToggle => false;
        public override string[] Tags => new[] { "days", "streak", "quota", "survived", "count" };
        public override Binding[] Requires => new Binding[] { GameBridge.SdSuccessfulQuota };

        private IntOption _days;

        protected override void Build()
        {
            _days = Opt(new IntOption("progress.days.value", "Set to", 0, 0, 9999));

            Act("Apply", () =>
            {
                var live = RunState.Live;
                if (live == null) { Notifier.Warn("No run is loaded."); return; }
                if (!GameBridge.SdSuccessfulQuota.Set(live, System.Convert.ChangeType(_days.Value, GameBridge.SdSuccessfulQuota.Field.FieldType)))
                {
                    Notifier.Error("Could not write the day count.");
                    return;
                }
                Notifier.Success($"Days survived set to {_days.Value.ToString(CultureInfo.InvariantCulture)}.");
            });
        }
    }
}
