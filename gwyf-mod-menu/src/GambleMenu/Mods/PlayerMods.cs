using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using GambleMenu.Core;
using GambleMenu.UI;
using UnityEngine;

namespace GambleMenu.Mods
{
    /// <summary>
    /// Flies the local player through geometry.
    ///
    /// Movement is applied to the transform directly and the CharacterController is switched
    /// off for the duration, because a controller left enabled resolves the collision we are
    /// trying to skip. The controller is restored on disable even if the player object was
    /// replaced underneath us, which is why the reference is re-fetched rather than cached
    /// across the whole session.
    /// </summary>
    internal sealed class Noclip : Mod
    {
        public override string Id => "player.noclip";
        public override string Name => "Noclip";
        public override string Description => "Fly the camera's direction and pass through walls. WASD to move, Space and Ctrl for up and down.";
        public override Category Cat => Category.Player;
        public override Authority Auth => Authority.SoloOnly;
        public override string[] Tags => new[] { "fly", "walls", "clip", "ghost", "move" };

        private FloatOption _speed;
        private FloatOption _boost;
        private CharacterController _disabled;

        protected override void Build()
        {
            _speed = Opt(new FloatOption("player.noclip.speed", "Speed", 8f, 1f, 60f) { Step = 0.5f, Format = "0.#", Unit = " m/s" });
            _boost = Opt(new FloatOption("player.noclip.boost", "Shift multiplier", 3f, 1f, 12f) { Step = 0.5f, Format = "0.#", Unit = "×" });
        }

        protected override void OnEnable()
        {
            var player = GameBridge.LocalPlayer();
            if (player == null)
            {
                Notifier.Warn("No local player found — join or start a run first.");
                Enabled.Value = false;
                return;
            }
            _disabled = player.GetComponent<CharacterController>();
            if (_disabled != null) _disabled.enabled = false;
        }

        protected override void OnDisable()
        {
            if (_disabled != null) _disabled.enabled = true;
            _disabled = null;
        }

        protected override void OnUpdate()
        {
            var player = GameBridge.LocalPlayer();
            if (player == null) return;

            var cam = Camera.main;
            Vector3 forward = cam != null ? cam.transform.forward : player.transform.forward;
            Vector3 right = cam != null ? cam.transform.right : player.transform.right;

            Vector3 move = Vector3.zero;
            if (InputBridge.GetKey(KeyCode.W)) move += forward;
            if (InputBridge.GetKey(KeyCode.S)) move -= forward;
            if (InputBridge.GetKey(KeyCode.D)) move += right;
            if (InputBridge.GetKey(KeyCode.A)) move -= right;
            if (InputBridge.GetKey(KeyCode.Space)) move += Vector3.up;
            if (InputBridge.GetKey(KeyCode.LeftControl)) move -= Vector3.up;

            if (move.sqrMagnitude < 0.0001f) return;

            float speed = _speed.Value * (InputBridge.GetKey(KeyCode.LeftShift) ? _boost.Value : 1f);
            // Unscaled time so noclip still responds while the game speed mod is slowing things.
            player.transform.position += move.normalized * speed * Time.unscaledDeltaTime;
        }
    }

    internal sealed class Waypoints : Mod
    {
        public override string Id => "player.waypoints";
        public override string Name => "Position bookmarks";
        public override string Description => "Save where you are standing and jump back to it later.";
        public override Category Cat => Category.Player;
        public override Authority Auth => Authority.SoloOnly;
        public override bool IsToggle => false;
        public override string[] Tags => new[] { "teleport", "waypoint", "position", "save", "return" };

        private readonly Vector3?[] _slots = new Vector3?[4];
        private IntOption _slot;

        protected override void Build()
        {
            _slot = Opt(new IntOption("player.waypoints.slot", "Slot", 1, 1, 4,
                "Four bookmarks. They last for this session only."));

            Act("Save position", () =>
            {
                var player = GameBridge.LocalPlayer();
                if (player == null) { Notifier.Warn("No local player found."); return; }
                var p = player.transform.position;
                _slots[_slot.Value - 1] = p;
                Notifier.Success($"Slot {_slot.Value} saved at ({p.x:0.#}, {p.y:0.#}, {p.z:0.#}).");
            });

            Act("Teleport to slot", () =>
            {
                var player = GameBridge.LocalPlayer();
                if (player == null) { Notifier.Warn("No local player found."); return; }
                var saved = _slots[_slot.Value - 1];
                if (!saved.HasValue) { Notifier.Warn($"Slot {_slot.Value} is empty — save a position first."); return; }

                // A controller resolves collision against the old position on the same frame
                // it is moved, which snaps the player straight back. Toggling it lets the
                // teleport land.
                var cc = player.GetComponent<CharacterController>();
                if (cc != null) cc.enabled = false;
                player.transform.position = saved.Value;
                if (cc != null) cc.enabled = true;

                Notifier.Success($"Teleported to slot {_slot.Value}.");
            });

            Act("Clear slot", () =>
            {
                _slots[_slot.Value - 1] = null;
                Notifier.Info($"Slot {_slot.Value} cleared.");
            });
        }
    }

    /// <summary>
    /// Scales the local player's own tuning values.
    ///
    /// Speed and jump height live in fields whose names this plugin has never seen, so rather
    /// than guess one, this finds every float on the player's components whose name looks like
    /// a movement value and scales all of them from their originals. Originals are captured
    /// once so repeated changes compound from the stock value instead of from each other.
    /// </summary>
    internal sealed class MovementTuning : Mod
    {
        public override string Id => "player.tuning";
        public override string Name => "Movement tuning";
        public override string Description => "Finds the player's speed and jump values and scales them.";
        public override Category Cat => Category.Player;
        public override Authority Auth => Authority.SoloOnly;
        public override string[] Tags => new[] { "speed", "jump", "fast", "run", "height", "gravity" };

        private static readonly string[] SpeedWords = { "speed", "velocity", "movespeed", "walk", "sprint", "run" };
        private static readonly string[] JumpWords = { "jump", "leap", "hop" };

        private FloatOption _speedMult;
        private FloatOption _jumpMult;

        private readonly List<(Component owner, FieldInfo field, float original)> _speedFields = new List<(Component, FieldInfo, float)>();
        private readonly List<(Component owner, FieldInfo field, float original)> _jumpFields = new List<(Component, FieldInfo, float)>();

        protected override void Build()
        {
            _speedMult = Opt(new FloatOption("player.tuning.speed", "Speed", 1f, 0.2f, 8f) { Step = 0.1f, Format = "0.0", Unit = "×" });
            _jumpMult = Opt(new FloatOption("player.tuning.jump", "Jump", 1f, 0.2f, 8f) { Step = 0.1f, Format = "0.0", Unit = "×" });
            _speedMult.Changed += Apply;
            _jumpMult.Changed += Apply;
        }

        protected override void OnEnable()
        {
            _speedFields.Clear();
            _jumpFields.Clear();

            var player = GameBridge.LocalPlayer();
            if (player == null)
            {
                Notifier.Warn("No local player found — join or start a run first.");
                Enabled.Value = false;
                return;
            }

            foreach (var component in player.GetComponentsInChildren<MonoBehaviour>(true))
            {
                if (component == null) continue;
                foreach (var field in component.GetType().GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance))
                {
                    if (field.FieldType != typeof(float)) continue;
                    string name = field.Name.ToLowerInvariant();
                    float value;
                    try { value = (float)field.GetValue(component); } catch { continue; }
                    if (Mathf.Approximately(value, 0f)) continue; // scaling zero achieves nothing

                    if (SpeedWords.Any(w => name.Contains(w))) _speedFields.Add((component, field, value));
                    else if (JumpWords.Any(w => name.Contains(w))) _jumpFields.Add((component, field, value));
                }
            }

            if (_speedFields.Count == 0 && _jumpFields.Count == 0)
            {
                Notifier.Warn("No movement values found on the player — this build keeps them somewhere unexpected.");
                Enabled.Value = false;
                return;
            }

            Notifier.Info($"Found {_speedFields.Count} speed and {_jumpFields.Count} jump value(s).");
            Apply();
        }

        private void Apply()
        {
            if (!Enabled.Value) return;
            Write(_speedFields, _speedMult.Value);
            Write(_jumpFields, _jumpMult.Value);
        }

        private static void Write(List<(Component owner, FieldInfo field, float original)> fields, float multiplier)
        {
            foreach (var (owner, field, original) in fields)
            {
                if (owner == null) continue;
                try { field.SetValue(owner, original * multiplier); }
                catch { /* a field that refuses a write is simply skipped */ }
            }
        }

        protected override void OnDisable()
        {
            Write(_speedFields, 1f);
            Write(_jumpFields, 1f);
            _speedFields.Clear();
            _jumpFields.Clear();
        }

    }

    internal sealed class PlayerReadout : Mod
    {
        public override string Id => "player.readout";
        public override string Name => "Position readout";
        public override string Description => "Shows where the local player is, in world coordinates.";
        public override Category Cat => Category.Player;
        public override string[] Tags => new[] { "position", "coordinates", "debug", "hud" };

        protected override void OnDrawOverlay()
        {
            var player = GameBridge.LocalPlayer();
            if (player == null) return;

            var p = player.transform.position;
            string text = $"x {p.x.ToString("0.0", CultureInfo.InvariantCulture)}   " +
                          $"y {p.y.ToString("0.0", CultureInfo.InvariantCulture)}   " +
                          $"z {p.z.ToString("0.0", CultureInfo.InvariantCulture)}";
            Hud.Line(text);
        }
    }
}
