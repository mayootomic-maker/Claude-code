using System;
using System.Collections.Generic;
using System.Reflection;
using GambleMenu.Core;
using GambleMenu.UI;
using UnityEngine;
using Object = UnityEngine.Object;

namespace GambleMenu.Mods
{
    /// <summary>
    /// Saves and restores the generator this game actually rolls with.
    ///
    /// The first version of this drove UnityEngine.Random, which was a guess and the wrong one.
    /// The game ships a <c>SeededRandomManager</c> — a name read out of a shipped mod's
    /// reference table, not inferred — and that is what decides outcomes. Copying Unity's
    /// generator while the game rolls from its own would have appeared to work and changed
    /// nothing, which is the worst kind of wrong.
    ///
    /// Its internals are not known, so the snapshot is taken by value rather than by name:
    /// every serialisable field on the manager is recorded and written back together. That
    /// restores whatever the state happens to be made of without needing to know its shape.
    /// </summary>
    internal sealed class RandomControl : Mod
    {
        public override string Id => "machines.rng";
        public override string Name => "Roll state";
        public override string Description => "Snapshots the game's own random generator so a round can be replayed from where it was decided.";
        public override Category Cat => Category.Machines;
        public override Authority Auth => Authority.SoloOnly;
        public override bool IsToggle => false;
        public override string[] Tags => new[] { "rng", "random", "seed", "reroll", "luck", "state", "roll" };
        public override Binding[] Requires => new Binding[] { GameBridge.TSeededRandom };

        private IntOption _seed;
        private BoolOption _alsoUnity;

        private readonly Dictionary<FieldInfo, object> _snapshot = new Dictionary<FieldInfo, object>();
        private UnityEngine.Random.State? _unitySnapshot;
        private string _status = "Nothing saved yet.";

        protected override void Build()
        {
            _seed = Opt(new IntOption("machines.rng.seed", "Seed", 12345, 0, int.MaxValue,
                "Written into any int field on the manager whose name mentions a seed."));
            _alsoUnity = Opt(new BoolOption("machines.rng.unity", "Also snapshot Unity's generator", true,
                "Cheap, and covers anything the game rolls through UnityEngine.Random as well."));

            Act("Save roll state", Save, "Take this immediately before a spin.");
            Act("Restore roll state", Restore, "Puts the generator back where it was.",
                canRun: () => _snapshot.Count > 0 || _unitySnapshot.HasValue);
            Act("Apply seed", ApplySeed, "Sets any seed field on the manager to the number above.");
            Act("What is in there?", Inspect, "Writes the manager's fields and values to a dump file.");
        }

        private Object Manager() => GameBridge.Instance(GameBridge.TSeededRandom);

        /// <summary>Fields worth snapshotting: the value types that can hold generator state.</summary>
        private static IEnumerable<FieldInfo> StateFields(Type t)
        {
            foreach (var f in t.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance))
                if (f.FieldType.IsPrimitive || f.FieldType.IsEnum) yield return f;
        }

        private void Save()
        {
            _snapshot.Clear();
            var manager = Manager();

            if (manager != null)
            {
                foreach (var f in StateFields(manager.GetType()))
                {
                    try { _snapshot[f] = f.GetValue(manager); }
                    catch { /* a field that will not read simply is not part of the snapshot */ }
                }
            }

            if (_alsoUnity.Value) _unitySnapshot = UnityEngine.Random.state;

            _status = manager == null
                ? "No live SeededRandomManager; Unity's generator saved instead."
                : $"Saved {_snapshot.Count} field(s) from {manager.GetType().Name}.";
            Notifier.Success(_status);
        }

        private void Restore()
        {
            var manager = Manager();
            int written = 0;

            if (manager != null)
            {
                foreach (var pair in _snapshot)
                {
                    try { pair.Key.SetValue(manager, pair.Value); written++; }
                    catch { /* read-only or refused; the rest still restore */ }
                }
            }

            if (_alsoUnity.Value && _unitySnapshot.HasValue) UnityEngine.Random.state = _unitySnapshot.Value;

            _status = $"Restored {written} field(s).";
            Notifier.Success(_status);
        }

        private void ApplySeed()
        {
            var manager = Manager();
            if (manager == null) { Notifier.Warn("No live SeededRandomManager right now."); return; }

            int written = 0;
            foreach (var f in StateFields(manager.GetType()))
            {
                if (f.FieldType != typeof(int)) continue;
                if (f.Name.IndexOf("seed", StringComparison.OrdinalIgnoreCase) < 0) continue;
                try { f.SetValue(manager, _seed.Value); written++; } catch { }
            }

            if (_alsoUnity.Value) UnityEngine.Random.InitState(_seed.Value);

            _status = written > 0
                ? $"Seed written to {written} field(s)."
                : "No seed-looking field found; Unity's generator was seeded instead.";
            Notifier.Info(_status);
        }

        private void Inspect()
        {
            var manager = Manager();
            if (manager == null) { Notifier.Warn("No live SeededRandomManager right now."); return; }

            var sb = new System.Text.StringBuilder();
            sb.AppendLine($"# {manager.GetType().FullName}").AppendLine();
            foreach (var f in manager.GetType().GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance))
            {
                object value;
                try { value = f.GetValue(manager); } catch (Exception ex) { value = "<threw: " + ex.Message + ">"; }
                sb.AppendLine($"{f.FieldType.Name,-16} {f.Name,-30} = {Reflect.Describe(value)}");
            }
            Dump.Write("roll-state.txt", sb.ToString());
        }

        public override float BodyHeight(float width) => 20f;

        public override void DrawBody(Rect area)
            => Draw.Label(area, _status, Styles.Small, Theme.P.TextMuted);
    }
}
