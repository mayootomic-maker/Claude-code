using System;
using GambleMenu.Core;
using UnityEngine;

namespace GambleMenu.Mods
{
    /// <summary>
    /// Overrides the length of a casino day.
    ///
    /// The value lives on a shared ScriptableObject, so it is restored on disable rather than
    /// left where we put it — the asset outlives the run and a stray value would follow the
    /// player into their next, unmodded session.
    /// </summary>
    internal sealed class DayLength : Mod
    {
        public override string Id => "timing.daylength";
        public override string Name => "Day length";
        public override string Description => "Sets how many seconds each run inside the casino lasts.";
        public override Category Cat => Category.Timing;
        public override Authority Auth => Authority.HostOnly;
        public override string[] Tags => new[] { "time", "timer", "day", "duration", "longer" };
        public override Binding[] Requires => new Binding[] { GameBridge.DayDuration };

        private FloatOption _seconds;
        private float? _original;

        protected override void Build()
        {
            _seconds = Opt(new FloatOption("timing.daylength.seconds", "Seconds per day", 600f, 10f, 3600f,
                "The stock day is five minutes. Clients show their own vanilla number on the clock; the host decides when the day actually ends.")
            { Step = 5f, Format = "0", Unit = "s" });
            _seconds.Changed += Apply;
        }

        protected override void OnEnable()
        {
            _original = RunState.DayDuration;
            if (!_original.HasValue)
            {
                Notifier.Warn("Day length could not be read — is a run loaded?");
                return;
            }
            Apply();
        }

        private void Apply()
        {
            if (!Enabled.Value) return;
            RunState.DayDuration = _seconds.Value;
        }

        protected override void OnDisable()
        {
            if (_original.HasValue) RunState.DayDuration = _original.Value;
            _original = null;
        }
    }

    internal sealed class FreezeDayTimer : Mod
    {
        public override string Id => "timing.freeze";
        public override string Name => "Freeze the day clock";
        public override string Description => "Holds the countdown where it is, so the day never runs out.";
        public override Category Cat => Category.Timing;
        public override Authority Auth => Authority.HostOnly;
        public override string[] Tags => new[] { "time", "freeze", "stop", "timer", "infinite" };
        public override Binding[] Requires => new Binding[] { GameBridge.DayTimer };

        private BoolOption _holdAtValue;
        private FloatOption _holdAt;
        private float _captured;
        private bool _hasCapture;

        protected override void Build()
        {
            _holdAtValue = Opt(new BoolOption("timing.freeze.custom", "Hold at a set time", false,
                "Off freezes wherever the clock was when you switched this on."));
            _holdAt = Opt(new FloatOption("timing.freeze.at", "Held at", 300f, 0f, 3600f,
                "Seconds remaining.") { Step = 5f, Format = "0", Unit = "s", VisibleWhen = () => _holdAtValue.Value });
        }

        protected override void OnEnable()
        {
            _hasCapture = false;
        }

        protected override void OnUpdate()
        {
            var gm = GameBridge.Instance(GameBridge.TGameManager);
            if (gm == null) return;

            if (_holdAtValue.Value)
            {
                Write(gm, _holdAt.Value);
                return;
            }

            if (!_hasCapture)
            {
                object current = GameBridge.DayTimer.Get(gm);
                if (current == null) return;
                try { _captured = Convert.ToSingle(current); _hasCapture = true; }
                catch { return; }
            }
            Write(gm, _captured);
        }

        private void Write(UnityEngine.Object gm, float value)
        {
            var field = GameBridge.DayTimer.Field;
            if (field == null) return;
            try { GameBridge.DayTimer.Set(gm, Convert.ChangeType(value, field.FieldType)); }
            catch { /* a build that stores the timer as something exotic simply does not freeze */ }
        }
    }

    internal sealed class GameSpeed : Mod
    {
        public override string Id => "timing.speed";
        public override string Name => "Game speed";
        public override string Description => "Scales how fast everything runs. Menus and this menu stay at normal speed.";
        public override Category Cat => Category.Timing;
        public override Authority Auth => Authority.SoloOnly;
        public override string[] Tags => new[] { "speed", "fast", "slow", "timescale", "motion" };

        private FloatOption _scale;
        private float _previous = 1f;

        protected override void Build()
        {
            _scale = Opt(new FloatOption("timing.speed.scale", "Speed", 1f, 0.1f, 5f,
                "Below 1 is slow motion. This is a local simulation setting, which is why it is solo-only — on a host it drags the whole lobby with it.")
            { Step = 0.1f, Format = "0.0", Unit = "×" });
            _scale.Changed += () => { if (Enabled.Value) Time.timeScale = _scale.Value; };
        }

        protected override void OnEnable()
        {
            _previous = Time.timeScale;
            Time.timeScale = _scale.Value;
        }

        protected override void OnDisable()
        {
            // Restore what was there, not a hardcoded 1 — the pause setting may own it.
            Time.timeScale = _previous;
        }
    }
}
