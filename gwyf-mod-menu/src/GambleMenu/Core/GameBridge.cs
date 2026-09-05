using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using HarmonyLib;
using UnityEngine;
using Object = UnityEngine.Object;

namespace GambleMenu.Core
{
    /// <summary>Why a binding could not be resolved, in words a user can act on.</summary>
    internal enum BindingState { Resolved, TypeMissing, MemberMissing, WrongShape }

    /// <summary>
    /// One named handle into the game's assemblies, resolved by string at startup.
    ///
    /// Nothing in this plugin references Assembly-CSharp at compile time. That is not
    /// squeamishness: a hard reference pins the plugin to one build of the game and turns
    /// the next patch into a hard crash on load, whereas a failed lookup here downgrades a
    /// single mod to "unavailable, and here is why".
    /// </summary>
    internal abstract class Binding
    {
        public string Id;
        public string Purpose;
        public BindingState State = BindingState.TypeMissing;
        public string Detail = "not resolved";

        public bool Ok => State == BindingState.Resolved;
    }

    internal sealed class TypeBinding : Binding
    {
        public Type Type;

        public TypeBinding(string id, string purpose) { Id = id; Purpose = purpose; }

        public void Resolve()
        {
            Type = AccessTools.TypeByName(Id);
            if (Type == null) { State = BindingState.TypeMissing; Detail = $"type '{Id}' not found in any loaded assembly"; return; }
            State = BindingState.Resolved;
            Detail = Type.FullName;
        }
    }

    internal sealed class FieldBinding : Binding
    {
        public FieldInfo Field;
        private readonly TypeBinding _owner;
        private readonly string _name;
        private readonly Type _expected;

        public FieldBinding(TypeBinding owner, string name, Type expected, string purpose)
        {
            _owner = owner; _name = name; _expected = expected;
            Id = $"{owner.Id}.{name}"; Purpose = purpose;
        }

        public void Resolve()
        {
            if (!_owner.Ok) { State = BindingState.TypeMissing; Detail = $"owner type '{_owner.Id}' missing"; return; }
            Field = AccessTools.Field(_owner.Type, _name);
            if (Field == null) { State = BindingState.MemberMissing; Detail = $"field '{_name}' not found on {_owner.Type.Name}"; return; }
            if (_expected != null && !_expected.IsAssignableFrom(Field.FieldType))
            {
                State = BindingState.WrongShape;
                Detail = $"field '{_name}' is {Field.FieldType.Name}, expected {_expected.Name}";
                return;
            }
            State = BindingState.Resolved;
            Detail = $"{Field.FieldType.Name} {Field.Name}";
        }

        public object Get(object instance)
        {
            if (!Ok) return null;
            try { return Field.GetValue(instance); }
            catch (Exception ex) { Log.Warn($"read {Id} failed: {ex.Message}"); return null; }
        }

        public bool Set(object instance, object value)
        {
            if (!Ok) return false;
            try { Field.SetValue(instance, value); return true; }
            catch (Exception ex) { Log.Warn($"write {Id} failed: {ex.Message}"); return false; }
        }
    }

    /// <summary>
    /// A field found by what it looks like rather than by a name written down here.
    ///
    /// Every other binding names its member, which is right when the name is known: it is
    /// exact, and a miss is unambiguous. It is useless for the parts of the game nobody here
    /// has ever seen. Tickets and the cosmetics you spend them on are the case in point --
    /// the field could be <c>tickets</c>, <c>ticketCount</c>, <c>numTickets</c> or
    /// <c>_tickets</c>, and picking one of the four is a mod that greys out on three builds
    /// in four for no reason a player could act on.
    ///
    /// So this takes the words the name should contain and the shape the field should have,
    /// and reports which field it settled on. When the exact name is later known it should be
    /// replaced by a plain FieldBinding: a guess that works is still a guess.
    /// </summary>
    internal sealed class FieldByShape : Binding
    {
        public FieldInfo Field;
        private readonly TypeBinding _owner;
        private readonly string[] _words;
        private readonly Func<Type, bool> _shape;
        private readonly string _shapeName;

        public FieldByShape(TypeBinding owner, string id, string[] words,
                            Func<Type, bool> shape, string shapeName, string purpose)
        {
            _owner = owner; _words = words; _shape = shape; _shapeName = shapeName;
            Id = $"{owner.Id}.~{id}"; Purpose = purpose;
        }

        public void Resolve()
        {
            if (!_owner.Ok) { State = BindingState.TypeMissing; Detail = $"owner type '{_owner.Id}' missing"; return; }

            FieldInfo best = null;
            int bestScore = int.MaxValue;
            foreach (var f in Reflect.Fields(_owner.Type))
            {
                if (!_shape(f.FieldType)) continue;
                var name = f.Name.ToLowerInvariant();
                bool hit = false;
                foreach (var w in _words) if (name.Contains(w)) { hit = true; break; }
                if (!hit) continue;
                // The shortest matching name wins: `tickets` over `ticketsSpentLifetime`,
                // which is the one that is actually the count.
                if (f.Name.Length >= bestScore) continue;
                bestScore = f.Name.Length;
                best = f;
            }

            if (best == null)
            {
                State = BindingState.MemberMissing;
                Detail = $"no {_shapeName} field on {_owner.Type.Name} named like "
                       + string.Join("/", _words);
                return;
            }
            Field = best;
            State = BindingState.Resolved;
            Detail = $"{Field.FieldType.Name} {Field.Name}  (found by shape)";
        }

        public object Get(object instance)
        {
            if (!Ok) return null;
            try { return Field.GetValue(instance); }
            catch (Exception ex) { Log.Warn($"read {Id} failed: {ex.Message}"); return null; }
        }

        public bool Set(object instance, object value)
        {
            if (!Ok) return false;
            try { Field.SetValue(instance, value); return true; }
            catch (Exception ex) { Log.Warn($"write {Id} failed: {ex.Message}"); return false; }
        }
    }

    internal sealed class MethodBinding : Binding
    {
        public MethodInfo Method;
        private readonly TypeBinding _owner;
        private readonly string _name;
        private readonly Type[] _args;

        public MethodBinding(TypeBinding owner, string name, Type[] args, string purpose)
        {
            _owner = owner; _name = name; _args = args;
            Id = $"{owner.Id}.{name}"; Purpose = purpose;
        }

        public void Resolve()
        {
            if (!_owner.Ok) { State = BindingState.TypeMissing; Detail = $"owner type '{_owner.Id}' missing"; return; }
            Method = _args != null
                ? AccessTools.Method(_owner.Type, _name, _args)
                : AccessTools.Method(_owner.Type, _name);
            if (Method == null) { State = BindingState.MemberMissing; Detail = $"method '{_name}' not found on {_owner.Type.Name}"; return; }
            State = BindingState.Resolved;
            Detail = $"{Method.ReturnType.Name} {Method.Name}({string.Join(", ", Method.GetParameters().Select(p => p.ParameterType.Name))})";
        }

        public object Invoke(object instance, params object[] args)
        {
            if (!Ok) return null;
            try { return Method.Invoke(instance, args); }
            catch (Exception ex) { Log.Warn($"invoke {Id} failed: {ex.Message}"); return null; }
        }
    }

    /// <summary>
    /// Every game handle the plugin knows about, resolved once and reported honestly.
    ///
    /// The member names here were read out of a shipped, MIT-licensed mod for this game
    /// (SaltedByte/sandboxmode) rather than guessed, so the core economy and timing hooks
    /// are known-good against the build that mod targets. Anything that later fails to
    /// resolve shows up in the Compatibility tab instead of failing silently.
    /// </summary>
    internal static class GameBridge
    {
        public static readonly List<Binding> All = new List<Binding>();

        // --- types -----------------------------------------------------------------
        public static readonly TypeBinding TGameSettings   = Add(new TypeBinding("GameSettings", "day length, quota curve, floor table"));
        public static readonly TypeBinding TGameManager    = Add(new TypeBinding("GameManager", "run state and the day timer"));
        public static readonly TypeBinding TSaveManager    = Add(new TypeBinding("SaveManager", "loads a run; server-only"));
        public static readonly TypeBinding TLocalSaveMgr   = Add(new TypeBinding("LocalSaveManager", "create/delete save slots on disk"));
        public static readonly TypeBinding TSaveData       = Add(new TypeBinding("SaveData", "money, quota, floor — the persisted run"));
        public static readonly TypeBinding TMoneyManager   = Add(new TypeBinding("MoneyManager", "the shared bank account"));
        public static readonly TypeBinding TDialog         = Add(new TypeBinding("ConfirmationDialogManager", "reuse the game's own dialog"));

        // --- the casino itself ------------------------------------------------------
        // These names were not inferred. They were read out of the reference tables of
        // five shipped mods for this game (AutoSlots, MachineControl, Crash100x, More Slots,
        // MoreUpgrades), which were compiled against the real assembly — so every member
        // below is one the game actually exposes rather than one that seemed plausible.
        public static readonly TypeBinding TGameBase        = Add(new TypeBinding("GameBase", "the base class every casino game derives from"));
        public static readonly TypeBinding TInteractable    = Add(new TypeBinding("InteractableBase", "anything the player can press"));
        public static readonly TypeBinding TPlayerInteract  = Add(new TypeBinding("PlayerInteract", "what the player is currently looking at"));
        public static readonly TypeBinding TSeededRandom    = Add(new TypeBinding("SeededRandomManager", "the game's own roll source"));
        public static readonly TypeBinding TCasinoGameType  = Add(new TypeBinding("CasinoGameType", "which game a machine is"));

        // The game keeps its own ledger of every round. Reading it beats inferring outcomes
        // from the bank moving, which cannot tell a win from a purchase or a friend's luck.
        public static readonly TypeBinding TPayoutTracker   = Add(new TypeBinding("PayoutTracker", "the game's own record of every round"));
        public static readonly TypeBinding TPayoutRecord    = Add(new TypeBinding("PayoutRecord", "one round: bet, payout, won or lost"));
        public static readonly TypeBinding TMinesweeperTile = Add(new TypeBinding("MinesweeperTile", "a tile on a grid game"));

        // --- Mirror ----------------------------------------------------------------
        public static readonly TypeBinding TNetworkServer  = Add(new TypeBinding("Mirror.NetworkServer", "am I the host?"));
        public static readonly TypeBinding TNetworkClient  = Add(new TypeBinding("Mirror.NetworkClient", "am I connected?"));
        public static readonly TypeBinding TNetworkBehav   = Add(new TypeBinding("Mirror.NetworkBehaviour", "find the local player"));
        public static readonly TypeBinding TNetworkIdent   = Add(new TypeBinding("Mirror.NetworkIdentity", "enumerate networked objects"));

        // --- members ---------------------------------------------------------------
        public static FieldBinding DayDuration;
        public static FieldBinding FloorData;
        public static MethodBinding GetQuota;

        public static FieldBinding SdMoney;
        public static FieldBinding SdCurrentQuota;
        public static FieldBinding SdCurrentFloor;
        public static FieldBinding SdRequiredQuotaToNextFloor;
        public static FieldBinding SdSuccessfulQuota;

        /* Tickets, and the cosmetics they buy.

           Found by shape rather than by name, because nothing here has ever seen this part of
           the game. Tickets are the currency the second-hand store takes, earned by finishing
           a night in profit, and the wardrobe is a set of ids you have unlocked -- so one is a
           number with "ticket" in its name and the other is a collection with "cosmetic",
           "unlock" or "owned" in its name. Both report which field they settled on, and the
           startup report lists every field on SaveData so the guess can be replaced with the
           real name. */
        public static FieldByShape SdTickets;
        public static FieldByShape SdCosmetics;

        /// <summary>The day countdown. Named from SandboxMode's note that clients read it as
        /// a synced SyncVar, so the host is the only place writing it means anything.</summary>
        public static FieldBinding DayTimer;

        // GameBase — one machine, fully described.
        public static FieldBinding GbGameName;
        public static FieldBinding GbGameType;
        public static FieldBinding GbIsPlaying;
        public static MethodBinding GbStartGame;
        public static MethodBinding GbTryStartGame;
        public static MethodBinding GbPayout;
        public static MethodBinding GbResetGame;

        public static MethodBinding InteractableName;
        public static MethodBinding GbMinBet;

        // PayoutRecord — exact, from the game, per round.
        public static FieldBinding PrBet;
        public static FieldBinding PrPayout;
        public static FieldBinding PrIsWin;
        public static FieldBinding PrIsLoss;
        public static FieldBinding PrGameType;
        public static MethodBinding GetPlayerRecords;

        public static MethodBinding CreateNewSave;
        public static MethodBinding DeleteSave;
        public static MethodBinding LoadGame;

        private static PropertyInfo _serverConnections;
        private static PropertyInfo _serverActive;
        private static PropertyInfo _clientActive;
        private static PropertyInfo _isLocalPlayer;

        private static bool _resolved;

        private static T Add<T>(T b) where T : Binding { All.Add(b); return b; }

        public static void Resolve()
        {
            if (_resolved) return;
            _resolved = true;

            foreach (var t in All.OfType<TypeBinding>()) t.Resolve();

            DayDuration = AddMember(new FieldBinding(TGameSettings, "dayDuration", typeof(float), "length of one casino day in seconds"));
            FloorData   = AddMember(new FieldBinding(TGameSettings, "floorData", typeof(IList), "the floor table; its Count is the top floor"));
            GetQuota    = AddMember(new MethodBinding(TGameSettings, "GetQuota", null, "the loan shark's daily demand"));

            SdMoney                    = AddMember(new FieldBinding(TSaveData, "money", typeof(long), "the shared bank balance"));
            SdCurrentQuota             = AddMember(new FieldBinding(TSaveData, "currentQuota", typeof(long), "this day's quota"));
            SdCurrentFloor             = AddMember(new FieldBinding(TSaveData, "currentFloor", typeof(int), "highest unlocked floor"));
            SdRequiredQuotaToNextFloor = AddMember(new FieldBinding(TSaveData, "requiredQuotaToNextFloor", typeof(long), "gate to the next floor"));
            SdSuccessfulQuota          = AddMember(new FieldBinding(TSaveData, "successfulQuota", null, "days survived"));

            SdTickets = AddMember(new FieldByShape(TSaveData, "tickets",
                new[] { "ticket" }, Reflect.IsNumeric, "numeric",
                "tickets, which is what the second-hand store takes"));
            SdCosmetics = AddMember(new FieldByShape(TSaveData, "cosmetics",
                new[] { "cosmetic", "unlocked", "owned", "wardrobe", "outfit" },
                t => typeof(IEnumerable).IsAssignableFrom(t) && t != typeof(string), "collection",
                "the cosmetics you have unlocked"));

            DayTimer = AddMember(new FieldBinding(TGameManager, "_timer", null, "the day countdown, in seconds"));

            GbGameName     = AddMember(new FieldBinding(TGameBase, "gameName", typeof(string), "the machine's name"));
            GbGameType     = AddMember(new FieldBinding(TGameBase, "gameType", null, "which casino game this is"));
            GbIsPlaying    = AddMember(new FieldBinding(TGameBase, "isPlaying", typeof(bool), "whether a round is running"));
            GbStartGame    = AddMember(new MethodBinding(TGameBase, "StartGame", null, "begin a round"));
            GbTryStartGame = AddMember(new MethodBinding(TGameBase, "TryStartGame", null, "what pressing the machine calls"));
            GbPayout       = AddMember(new MethodBinding(TGameBase, "Payout", null, "the result, at its source"));
            GbResetGame    = AddMember(new MethodBinding(TGameBase, "ResetGame", null, "end of a round"));

            InteractableName = AddMember(new MethodBinding(TInteractable, "get_InteractableName", null, "the prompt shown for a pressable thing"));
            GbMinBet         = AddMember(new MethodBinding(TGameBase, "get_MinBet", null, "the smallest stake this machine takes"));

            PrBet      = AddMember(new FieldBinding(TPayoutRecord, "bet", null, "what was staked"));
            PrPayout   = AddMember(new FieldBinding(TPayoutRecord, "payout", null, "what came back"));
            PrIsWin    = AddMember(new FieldBinding(TPayoutRecord, "isWin", typeof(bool), "the round was won"));
            PrIsLoss   = AddMember(new FieldBinding(TPayoutRecord, "isLoss", typeof(bool), "the round was lost"));
            PrGameType = AddMember(new FieldBinding(TPayoutRecord, "gameType", null, "which game the round was on"));
            GetPlayerRecords = AddMember(new MethodBinding(TPayoutTracker, "GetPlayerRecords", null, "every round this player has played"));

            CreateNewSave = AddMember(new MethodBinding(TLocalSaveMgr, "CreateNewSave", new[] { typeof(string) }, "make a save slot"));
            DeleteSave    = AddMember(new MethodBinding(TLocalSaveMgr, "DeleteSave", new[] { typeof(string) }, "remove a save slot"));
            LoadGame      = AddMember(new MethodBinding(TSaveManager, "LoadGame", null, "server-side run load"));

            if (TNetworkServer.Ok)
            {
                _serverActive = AccessTools.Property(TNetworkServer.Type, "active");
                _serverConnections = AccessTools.Property(TNetworkServer.Type, "connections");
            }
            if (TNetworkClient.Ok) _clientActive = AccessTools.Property(TNetworkClient.Type, "active");
            if (TNetworkBehav.Ok)  _isLocalPlayer = AccessTools.Property(TNetworkBehav.Type, "isLocalPlayer");

            int ok = All.Count(b => b.Ok);
            Log.Info($"bindings resolved: {ok}/{All.Count}");
            foreach (var b in All.Where(b => !b.Ok))
                Log.Warn($"  unresolved {b.Id} — {b.Detail} (wanted for: {b.Purpose})");
        }

        private static T AddMember<T>(T b) where T : Binding
        {
            switch (b)
            {
                case FieldBinding f: f.Resolve(); break;
                case FieldByShape s: s.Resolve(); break;
                case MethodBinding m: m.Resolve(); break;
            }
            All.Add(b);
            return b;
        }

        // --- network posture -------------------------------------------------------

        /// <summary>True when this process runs the authoritative simulation. Mods that write
        /// shared state check this: writing money on a client desyncs the lobby rather than
        /// cheating in it.</summary>
        public static bool IsHost
        {
            get
            {
                try { return _serverActive != null && (bool)_serverActive.GetValue(null); }
                catch { return false; }
            }
        }

        public static bool IsConnected
        {
            get
            {
                try { return _clientActive != null && (bool)_clientActive.GetValue(null); }
                catch { return false; }
            }
        }

        /// <summary>Host of a lobby with no one else in it — where anything goes safely.</summary>
        public static bool IsSolo => IsHost && PlayerCount <= 1;

        public static int PlayerCount
        {
            get
            {
                try
                {
                    if (_serverConnections == null) return 1;
                    var conns = _serverConnections.GetValue(null);
                    if (conns is ICollection c) return Mathf.Max(1, c.Count);
                }
                catch { /* Mirror internals vary by version; a wrong player count must not throw */ }
                return 1;
            }
        }

        // --- instance lookup -------------------------------------------------------

        private static readonly Dictionary<Type, Object> _singletons = new Dictionary<Type, Object>();

        /// <summary>
        /// Finds the live instance of a scene type, cached until it is destroyed.
        ///
        /// FindObjectOfType is far too slow to call per frame, and Unity's overloaded
        /// equality means a destroyed object is non-null to <c>ReferenceEquals</c> but null
        /// to <c>==</c> — so the cache is validated with the Unity comparison, not the CLR one.
        /// </summary>
        public static Object Instance(TypeBinding type)
        {
            if (!type.Ok) return null;
            if (_singletons.TryGetValue(type.Type, out var cached) && cached != null) return cached;

            Object found = null;
            try { found = Object.FindObjectOfType(type.Type); }
            catch (Exception ex) { Log.Warn($"FindObjectOfType({type.Id}) failed: {ex.Message}"); }

            if (found != null) _singletons[type.Type] = found;
            return found;
        }

        public static void InvalidateInstances()
        {
            _singletons.Clear();
            _localPlayer = null;
        }

        /// <summary>Held between frames rather than looked up per call; see LocalPlayer.</summary>
        private static GameObject _localPlayer;

        /// <summary>
        /// The shared GameSettings asset. It is a ScriptableObject loaded from Resources, so
        /// every system in the game — and every mod — sees the same object; writes here are
        /// immediately live but persist for the session only.
        /// </summary>
        public static Object Settings()
        {
            if (!TGameSettings.Ok) return null;
            if (_singletons.TryGetValue(TGameSettings.Type, out var cached) && cached != null) return cached;
            try
            {
                var loaded = Resources.Load("GameSettings", TGameSettings.Type);
                if (loaded != null) { _singletons[TGameSettings.Type] = loaded; return loaded; }
            }
            catch (Exception ex) { Log.Warn($"Resources.Load(GameSettings) failed: {ex.Message}"); }
            return Instance(TGameSettings);
        }

        /// <summary>The local player's root GameObject, found through Mirror rather than by
        /// name, so it keeps working when the prefab is renamed.</summary>
        public static GameObject LocalPlayer()
        {
            if (!TNetworkBehav.Ok || _isLocalPlayer == null) return null;

            // Seven mods call this, several of them from OnUpdate, and the scan below walks
            // every NetworkBehaviour in the scene reading a field off each by reflection. Left
            // uncached that is a handful of full-scene sweeps per frame on a populated floor,
            // which is felt as the game stuttering rather than as any mod misbehaving.
            // The player outlives everything except a scene change, and that already clears
            // this cache through InvalidateInstances.
            if (_localPlayer != null) return _localPlayer;

            try
            {
                var behaviours = Object.FindObjectsOfType(TNetworkBehav.Type);
                foreach (var b in behaviours)
                {
                    if (!(bool)_isLocalPlayer.GetValue(b)) continue;
                    var mb = b as MonoBehaviour;
                    if (mb == null) continue;
                    // Prefer a body that actually moves: the local player owns several
                    // NetworkBehaviours and only one of them carries the controller.
                    if (mb.GetComponent<CharacterController>() != null || mb.GetComponent<Rigidbody>() != null)
                        return _localPlayer = mb.gameObject;
                }
                foreach (var b in behaviours)
                {
                    if (!(bool)_isLocalPlayer.GetValue(b)) continue;
                    if (b is MonoBehaviour mb) return _localPlayer = mb.gameObject;
                }
            }
            catch (Exception ex) { Log.Warn($"LocalPlayer lookup failed: {ex.Message}"); }

            // Deliberately not cached: before the player spawns this is null every frame, and
            // caching a null would mean never finding them once they do.
            return null;
        }
    }
}
