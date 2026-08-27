using System;
using System.Collections.Generic;
using System.Reflection;
using GambleMenu.Core;
using GambleMenu.UI;
using UnityEngine;

namespace GambleMenu.Mods
{
    /// <summary>One pickable square on a grid game, and whether it is the bad one.</summary>
    internal sealed class GridTile
    {
        public Component Owner;
        public FieldInfo Flag;
        /// <summary>True when the flag being set means danger rather than safety.</summary>
        public bool FlagMeansBad;
        public Transform Where;

        public bool? Safe
        {
            get
            {
                if (Owner == null || Flag == null) return null;
                try
                {
                    if (!(Flag.GetValue(Owner) is bool raised)) return null;
                    return FlagMeansBad ? !raised : raised;
                }
                catch { return null; }
            }
        }
    }

    /// <summary>
    /// Marks which square is safe on a grid game, before you pick it.
    ///
    /// This is the honest answer to "where do I press". Games like Minesweeper — and the tower
    /// games built the same way — decide their layout when the round starts and then hide it
    /// behind unrevealed tiles, so the answer already exists in the tile objects and is simply
    /// not shown to you yet.
    ///
    /// <c>MinesweeperTile</c> is a confirmed type in this game, read from a shipped mod's
    /// reference table. The tower is not: no published mod names it, so rather than guess a
    /// class name this finds tiles by shape — a child component of the machine carrying a
    /// boolean that decides the round. That covers Minesweeper today and any grid game built
    /// the same way, which the towers almost certainly are. If a tower turns out to differ,
    /// the startup report now lists each machine's own fields, and one look finishes the job.
    /// </summary>
    internal sealed class TileRead : Mod
    {
        public override string Id => "machines.tiles";
        public override string Name => "Safe tile";
        public override string Description => "On grid games, marks which squares are safe to pick before you pick them.";
        public override Category Cat => Category.Machines;
        public override Authority Auth => Authority.SoloOnly;
        public override string[] Tags => new[] { "tile", "safe", "mine", "bomb", "dragon", "tower", "grid", "minesweeper", "pick", "where" };
        public override Binding[] Requires => new Binding[] { GameBridge.TGameBase };

        /// <summary>Field names that decide a tile, and whether the name means danger.</summary>
        private static readonly (string word, bool meansBad)[] Signals =
        {
            ("ismine", true), ("mine", true), ("isbomb", true), ("bomb", true),
            ("isdragon", true), ("dragon", true), ("isbad", true), ("islose", true),
            ("islosing", true), ("istrap", true), ("skull", true),
            ("issafe", false), ("safe", false), ("isegg", false), ("isgood", false),
            ("iswin", false), ("iswinning", false), ("isprize", false),
        };

        private FloatOption _reach;
        private BoolOption _onlyUnrevealed;
        private BoolOption _markSafe;
        private ColorOption _safeColour, _badColour;

        private Component _machine;
        private readonly List<GridTile> _tiles = new List<GridTile>();
        private float _nextPoll;
        private string _status = "";

        protected override void Build()
        {
            _reach = Opt(new FloatOption("machines.tiles.reach", "Look distance", 6f, 1f, 25f)
            { Step = 0.5f, Format = "0.#", Unit = "m" });
            _markSafe = Opt(new BoolOption("machines.tiles.safe", "Mark the safe ones too", true,
                "Off marks only what to avoid, which is less to look at."));
            _onlyUnrevealed = Opt(new BoolOption("machines.tiles.hidden", "Skip already-revealed tiles", true,
                "A tile the game has already turned over needs no marker."));
            _safeColour = Opt(new ColorOption("machines.tiles.safecolour", "Safe", new Color(0.36f, 0.85f, 0.55f, 1f)));
            _badColour = Opt(new ColorOption("machines.tiles.badcolour", "Avoid", new Color(0.94f, 0.38f, 0.43f, 1f)));

            Act("What did it find?", () =>
            {
                if (_machine == null) { Notifier.Warn("Look at a grid game first."); return; }
                var sb = new System.Text.StringBuilder();
                sb.AppendLine($"# {_machine.GetType().Name}  —  {_tiles.Count} tile(s)").AppendLine();
                foreach (var t in _tiles)
                    sb.AppendLine($"{t.Owner.GetType().Name,-24} {t.Flag.Name,-20} " +
                                  $"means {(t.FlagMeansBad ? "danger" : "safety")}  now={t.Safe}");
                Dump.Write($"tiles-{_machine.GetType().Name}.txt", sb.ToString());
            }, "Writes the tile components and the field it read, for a game it does not recognise.");
        }

        protected override void OnEnable()
        {
            _machine = null;
            _tiles.Clear();
            _nextPoll = 0f;
            _status = "";
        }

        protected override void OnUpdate()
        {
            if (Time.unscaledTime < _nextPoll) return;
            _nextPoll = Time.unscaledTime + 0.25f;

            var cam = Camera.main;
            if (cam == null) return;

            Component found = null;
            if (Physics.Raycast(cam.transform.position, cam.transform.forward, out RaycastHit hit, _reach.Value) &&
                hit.collider != null)
                found = hit.collider.GetComponentInParent(GameBridge.TGameBase.Type) as Component;

            if (found != _machine)
            {
                _machine = found;
                _tiles.Clear();
                if (_machine != null) FindTiles();
            }
        }

        /// <summary>
        /// Finds the tiles and the one field on each that decides the round.
        ///
        /// Done once when the aimed machine changes, not per frame: the set of tiles is fixed
        /// for a round, and only their values move.
        /// </summary>
        private void FindTiles()
        {
            var seenTypes = new HashSet<Type>();

            foreach (var component in _machine.GetComponentsInChildren<MonoBehaviour>(false))
            {
                if (component == null || component == _machine) continue;

                var type = component.GetType();
                var ns = type.Namespace;
                if (ns != null && (ns.StartsWith("UnityEngine", StringComparison.Ordinal) ||
                                   ns.StartsWith("GambleMenu", StringComparison.Ordinal))) continue;

                var flag = DecidingField(type);
                if (flag == null) continue;

                _tiles.Add(new GridTile
                {
                    Owner = component,
                    Flag = flag.Value.field,
                    FlagMeansBad = flag.Value.meansBad,
                    Where = component.transform
                });
                seenTypes.Add(type);
            }

            _status = _tiles.Count == 0
                ? "no tiles on this machine"
                : $"{_tiles.Count} tile(s) · {string.Join(", ", NamesOf(seenTypes))}";

            if (_tiles.Count > 0) Notifier.Success($"Safe tile: reading {_status}");
        }

        private static IEnumerable<string> NamesOf(HashSet<Type> types)
        {
            foreach (var t in types) yield return t.Name;
        }

        /// <summary>The boolean on a tile that says whether picking it ends the round.</summary>
        private static (FieldInfo field, bool meansBad)? DecidingField(Type type)
        {
            var fields = type.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);

            // Longest match first, so "isMine" is not beaten by a bare "mine" appearing in
            // some unrelated name, and an explicit "isSafe" wins over a generic "safe".
            foreach (var (word, meansBad) in Signals)
                foreach (var f in fields)
                {
                    if (f.FieldType != typeof(bool)) continue;
                    if (f.Name.ToLowerInvariant().Contains(word)) return (f, meansBad);
                }

            return null;
        }

        /// <summary>True when the game has already turned this tile over.</summary>
        private static bool Revealed(Component owner)
        {
            try
            {
                foreach (var f in owner.GetType().GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance))
                {
                    if (f.FieldType != typeof(bool)) continue;
                    string n = f.Name.ToLowerInvariant();
                    if (!n.Contains("reveal") && !n.Contains("flipped") && !n.Contains("opened") && !n.Contains("picked")) continue;
                    if (f.GetValue(owner) is bool b) return b;
                }
            }
            catch { }
            return false;
        }

        protected override void OnDrawOverlay()
        {
            var cam = Camera.main;
            if (cam == null) return;

            if (_machine == null) { Hud.Line("tiles     look at a grid game"); return; }
            if (_tiles.Count == 0) { Hud.Line($"tiles     {_status}"); return; }

            int safe = 0, bad = 0;

            foreach (var tile in _tiles)
            {
                if (tile.Where == null) continue;
                if (_onlyUnrevealed.Value && Revealed(tile.Owner)) continue;

                bool? isSafe = tile.Safe;
                if (!isSafe.HasValue) continue;

                if (isSafe.Value) { safe++; if (!_markSafe.Value) continue; }
                else bad++;

                Color colour = isSafe.Value ? _safeColour.Value : _badColour.Value;
                if (!Hud.Project(cam, tile.Where.position, out Vector2 at)) continue;

                Hud.Pin(at, isSafe.Value ? 'w' : 'l', colour, 0.62f);
            }

            Hud.Line($"tiles     {safe} safe · {bad} to avoid");
        }
    }
}
