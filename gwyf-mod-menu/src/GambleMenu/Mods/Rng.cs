using GambleMenu.Core;
using GambleMenu.UI;
using UnityEngine;

namespace GambleMenu.Mods
{
    /// <summary>
    /// Saves and restores Unity's random number generator.
    ///
    /// Where a game rolls its outcomes through UnityEngine.Random, the generator's whole state
    /// is a value you can copy and put back — so a round can be replayed from exactly the point
    /// it was decided. Save the state, spin, and if it went badly restore it and nudge the
    /// sequence; the next roll then comes from a different place in the stream.
    ///
    /// The honest caveat is that plenty of games do not use it. A System.Random instance, a
    /// hand-rolled generator or a server-side roll are all common, and none of them are touched
    /// by this. There is no way to tell which from outside, so the way to find out is to save a
    /// state, spin, restore, and see whether the result repeats.
    /// </summary>
    internal sealed class RandomControl : Mod
    {
        public override string Id => "machines.rng";
        public override string Name => "Random state";
        public override string Description => "Save, restore and reseed Unity's random generator, where the game uses it.";
        public override Category Cat => Category.Machines;
        public override Authority Auth => Authority.SoloOnly;
        public override bool IsToggle => false;
        public override string[] Tags => new[] { "rng", "random", "seed", "reroll", "luck", "state", "reset" };

        private IntOption _seed;
        private IntOption _nudge;

        private Random.State? _saved;
        private string _testResult = "";

        protected override void Build()
        {
            _seed = Opt(new IntOption("machines.rng.seed", "Seed", 12345, 0, int.MaxValue,
                "Reseeding makes the sequence repeatable from a known point."));
            _nudge = Opt(new IntOption("machines.rng.nudge", "Values to burn", 1, 0, 64,
                "After restoring, draw this many values first so the next roll differs from the one you just had."));

            Act("Save state", () =>
            {
                _saved = Random.state;
                Notifier.Success("Random state saved.");
            }, "Take this immediately before a spin.");

            Act("Restore state", () =>
            {
                if (!_saved.HasValue) { Notifier.Warn("Nothing saved yet."); return; }
                Random.state = _saved.Value;
                for (int i = 0; i < _nudge.Value; i++) { float _ = Random.value; }
                Notifier.Success(_nudge.Value > 0
                    ? $"Restored, then burned {_nudge.Value} value(s)."
                    : "Restored exactly.");
            }, canRun: () => _saved.HasValue);

            Act("Reseed", () =>
            {
                Random.InitState(_seed.Value);
                Notifier.Success($"Reseeded to {_seed.Value}.");
            }, "Starts the sequence again from a known point.");

            Act("Can this be steered?", TestUsage,
                "Rolls, restores, and rolls again to confirm the generator round-trips.");
        }

        /// <summary>
        /// Confirms the generator restores predictably.
        ///
        /// This proves only that Random itself round-trips — not that the game draws from it,
        /// which cannot be observed from outside. The message says exactly that rather than
        /// implying a guarantee it has not earned.
        /// </summary>
        private void TestUsage()
        {
            var before = Random.state;
            float a = Random.value;
            Random.state = before;
            float b = Random.value;
            Random.state = before;

            bool deterministic = Mathf.Approximately(a, b);
            _testResult = deterministic
                ? "Restoring works here. Whether the game rolls through this generator is the next question, and only a real spin answers it: save a state, spin, restore, spin again. A repeated result means yes."
                : "Restoring did not reproduce the same value, so this generator cannot be steered.";

            if (deterministic) Notifier.Success("Random state restores correctly — now try it on a real spin.");
            else Notifier.Warn("This generator does not restore predictably.");
        }

        public override float BodyHeight(float width) =>
            string.IsNullOrEmpty(_testResult) ? 0f : Styles.WrapSmall.CalcHeight(new GUIContent(_testResult), width - 8f) + 8f;

        public override void DrawBody(Rect area)
        {
            if (string.IsNullOrEmpty(_testResult)) return;
            Draw.Label(area, _testResult, Styles.WrapSmall, Theme.P.TextMuted);
        }
    }
}
