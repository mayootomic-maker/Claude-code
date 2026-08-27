using System.Collections.Generic;
using GambleMenu.Core;
using GambleMenu.UI;
using UnityEngine;
using Object = UnityEngine.Object;

namespace GambleMenu.Mods
{
    /// <summary>
    /// Detaches the camera and flies it.
    ///
    /// The camera is unparented rather than duplicated: a second camera has to be told about
    /// the first one's culling mask, clear flags, projection and post-processing stack to look
    /// remotely the same, and gets all of it wrong on any pipeline it was not written for.
    /// Moving the real one costs nothing and looks correct by construction — provided its
    /// parent and local transform are put back exactly, which is what OnDisable is for.
    /// </summary>
    internal sealed class FreeCamera : Mod
    {
        public override string Id => "player.freecam";
        public override string Name => "Free camera";
        public override string Description => "Unhooks the camera and flies it. WASD, Space and Ctrl, Shift to hurry.";
        public override Category Cat => Category.Player;
        public override Authority Auth => Authority.SoloOnly;
        public override string[] Tags => new[] { "camera", "freecam", "fly", "spectate", "photo", "view" };

        private FloatOption _speed, _boost, _sensitivity;
        private BoolOption _mouseLook;

        private Camera _camera;
        private Transform _parent;
        private Vector3 _localPos;
        private Quaternion _localRot;
        private float _yaw, _pitch;

        protected override void Build()
        {
            _speed = Opt(new FloatOption("player.freecam.speed", "Speed", 6f, 0.5f, 60f) { Step = 0.5f, Format = "0.#", Unit = " m/s" });
            _boost = Opt(new FloatOption("player.freecam.boost", "Shift multiplier", 4f, 1f, 20f) { Step = 0.5f, Format = "0.#", Unit = "×" });
            _mouseLook = Opt(new BoolOption("player.freecam.look", "Steer with the mouse", true,
                "Off keeps the camera's current facing, which is what you want for a fixed shot."));
            _sensitivity = Opt(new FloatOption("player.freecam.sens", "Mouse sensitivity", 2f, 0.2f, 8f)
            { Step = 0.1f, Format = "0.0", VisibleWhen = () => _mouseLook.Value });
        }

        protected override void OnEnable()
        {
            _camera = Camera.main;
            if (_camera == null)
            {
                Notifier.Warn("No main camera found.");
                Enabled.Value = false;
                return;
            }

            var t = _camera.transform;
            _parent = t.parent;
            _localPos = t.localPosition;
            _localRot = t.localRotation;

            var euler = t.eulerAngles;
            _yaw = euler.y;
            _pitch = euler.x > 180f ? euler.x - 360f : euler.x;

            t.SetParent(null, true);
        }

        protected override void OnDisable()
        {
            if (_camera == null) return;
            var t = _camera.transform;
            t.SetParent(_parent, false);
            t.localPosition = _localPos;
            t.localRotation = _localRot;
            _camera = null;
        }

        protected override void OnUpdate()
        {
            if (_camera == null) return;
            var t = _camera.transform;

            if (_mouseLook.Value && !MenuController.IsOpenNow)
            {
                // Mouse axes come from the legacy API only; on an Input System game this is
                // simply skipped rather than throwing, and movement still works.
                try
                {
                    _yaw += Input.GetAxisRaw("Mouse X") * _sensitivity.Value;
                    _pitch = Mathf.Clamp(_pitch - Input.GetAxisRaw("Mouse Y") * _sensitivity.Value, -89f, 89f);
                    t.rotation = Quaternion.Euler(_pitch, _yaw, 0f);
                }
                catch { /* no legacy axes on this build */ }
            }

            Vector3 move = Vector3.zero;
            if (InputBridge.GetKey(KeyCode.W)) move += t.forward;
            if (InputBridge.GetKey(KeyCode.S)) move -= t.forward;
            if (InputBridge.GetKey(KeyCode.D)) move += t.right;
            if (InputBridge.GetKey(KeyCode.A)) move -= t.right;
            if (InputBridge.GetKey(KeyCode.Space)) move += Vector3.up;
            if (InputBridge.GetKey(KeyCode.LeftControl)) move -= Vector3.up;

            if (move.sqrMagnitude < 0.0001f) return;
            float speed = _speed.Value * (InputBridge.GetKey(KeyCode.LeftShift) ? _boost.Value : 1f);
            t.position += move.normalized * speed * Time.unscaledDeltaTime;
        }

        protected override void OnDrawOverlay() => Hud.Line("freecam   WASD · Space/Ctrl · Shift");
    }

    internal sealed class ThirdPerson : Mod
    {
        public override string Id => "player.thirdperson";
        public override string Name => "Third person";
        public override string Description => "Pulls the camera back off your head. Purely local — nobody else sees a difference.";
        public override Category Cat => Category.Player;
        public override string[] Tags => new[] { "camera", "third person", "back", "view", "shoulder" };

        private FloatOption _distance, _height, _side;
        private Camera _camera;
        private Vector3 _original;

        protected override void Build()
        {
            _distance = Opt(new FloatOption("player.thirdperson.dist", "Distance back", 2.5f, 0.2f, 12f) { Step = 0.1f, Format = "0.0", Unit = "m" });
            _height = Opt(new FloatOption("player.thirdperson.height", "Height", 0.6f, -2f, 4f) { Step = 0.1f, Format = "0.0", Unit = "m" });
            _side = Opt(new FloatOption("player.thirdperson.side", "Sideways", 0f, -3f, 3f) { Step = 0.1f, Format = "0.0", Unit = "m" });
        }

        protected override void OnEnable()
        {
            _camera = Camera.main;
            if (_camera == null) { Notifier.Warn("No main camera found."); Enabled.Value = false; return; }
            _original = _camera.transform.localPosition;
        }

        protected override void OnDisable()
        {
            if (_camera != null) _camera.transform.localPosition = _original;
            _camera = null;
        }

        protected override void OnLateUpdate()
        {
            // LateUpdate, because the game moves its camera in Update and an offset applied
            // before that is overwritten within the same frame.
            if (_camera == null) return;
            _camera.transform.localPosition = _original
                                            + Vector3.back * _distance.Value
                                            + Vector3.up * _height.Value
                                            + Vector3.right * _side.Value;
        }
    }

    internal sealed class Zoom : Mod
    {
        public override string Id => "visual.zoom";
        public override string Name => "Zoom";
        public override string Description => "Hold a key to narrow the field of view, like a spyglass.";
        public override Category Cat => Category.Visual;
        public override string[] Tags => new[] { "zoom", "scope", "fov", "magnify", "look" };

        private KeyOption _key;
        private FloatOption _factor, _speed;
        private Camera _camera;
        private float _base = -1f;
        private float _current;

        protected override void Build()
        {
            _key = Opt(new KeyOption("visual.zoom.key", "Hold to zoom", KeyCode.Z));
            _factor = Opt(new FloatOption("visual.zoom.factor", "Zoom", 4f, 1.2f, 20f,
                "The field of view is divided by this while held.") { Step = 0.2f, Format = "0.0", Unit = "×" });
            _speed = Opt(new FloatOption("visual.zoom.speed", "Transition", 10f, 1f, 40f,
                "How quickly it moves in and out.") { Step = 1f, Format = "0" });
        }

        protected override void OnEnable()
        {
            _camera = Camera.main;
            if (_camera == null) { Notifier.Warn("No main camera found."); Enabled.Value = false; return; }
            _base = _camera.fieldOfView;
            _current = _base;
        }

        protected override void OnDisable()
        {
            if (_camera != null && _base > 0f) _camera.fieldOfView = _base;
            _camera = null;
            _base = -1f;
        }

        protected override void OnLateUpdate()
        {
            if (_camera == null) return;
            // Track the game's own FOV while not zooming, so another mod changing it is not
            // fought over, and zoom stays relative to whatever is current.
            if (_base < 0f) _base = _camera.fieldOfView;

            bool held = !MenuController.IsOpenNow && InputBridge.GetKey(_key.Value);
            float target = held ? _base / _factor.Value : _base;

            _current = Mathf.Lerp(_current, target, 1f - Mathf.Exp(-_speed.Value * Time.unscaledDeltaTime));
            _camera.fieldOfView = _current;
        }
    }

    /// <summary>
    /// Hides the game's own interface.
    ///
    /// Toggles Canvas components rather than destroying anything, so it is completely
    /// reversible — and it deliberately leaves this menu's own IMGUI alone, which is drawn
    /// outside the canvas system entirely.
    /// </summary>
    internal sealed class CleanScreen : Mod
    {
        public override string Id => "visual.cleanhud";
        public override string Name => "Hide the game's interface";
        public override string Description => "Switches off the game's on-screen UI for a clean view. Reversible.";
        public override Category Cat => Category.Visual;
        public override string[] Tags => new[] { "hud", "ui", "clean", "screenshot", "hide", "photo" };

        private KeyOption _toggleKey;
        private BoolOption _hideOurs;
        private readonly List<Canvas> _hidden = new List<Canvas>();
        private bool _hiddenNow;

        protected override void Build()
        {
            _toggleKey = Opt(new KeyOption("visual.cleanhud.key", "Toggle key", KeyCode.F11,
                "Flips the game's interface on and off without opening this menu."));
            _hideOurs = Opt(new BoolOption("visual.cleanhud.ours", "Hide this menu's overlay too", true,
                "Also hides the readout lines and markers while the interface is hidden."));
        }

        protected override void OnEnable() => Hide();

        protected override void OnUpdate()
        {
            if (MenuController.IsOpenNow || !InputBridge.GetKeyDown(_toggleKey.Value)) return;
            if (_hiddenNow) Show(); else Hide();
        }

        private void Hide()
        {
            _hidden.Clear();
            try
            {
                foreach (var canvas in Object.FindObjectsOfType<Canvas>())
                {
                    if (canvas == null || !canvas.enabled) continue;
                    canvas.enabled = false;
                    _hidden.Add(canvas);
                }
            }
            catch (System.Exception ex) { Log.Warn($"could not hide the interface: {ex.Message}"); }

            _hiddenNow = true;
            Hud.Suppressed = _hideOurs.Value;
        }

        private void Show()
        {
            foreach (var canvas in _hidden)
                if (canvas != null) canvas.enabled = true;
            _hidden.Clear();
            _hiddenNow = false;
            Hud.Suppressed = false;
        }

        protected override void OnDisable() => Show();
    }
}
