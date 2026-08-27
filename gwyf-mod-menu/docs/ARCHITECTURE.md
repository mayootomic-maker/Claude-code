# How this is put together

## The one decision everything else follows from

The plugin never references `Assembly-CSharp`. It cannot: the game was not available when
this was written. That constraint turned out to be the right architecture anyway.

A conventional BepInEx mod does this:

```csharp
[HarmonyPatch(typeof(GameSettings), nameof(GameSettings.GetQuota))]
```

which is checked at compile time, reads well, and hard-fails the entire plugin the moment the
game ships a build where `GetQuota` moved. Every mod in the DLL dies together, usually with a
`TypeLoadException` before `Awake` runs.

This does it by name instead, at load:

```csharp
GetQuota = new MethodBinding(TGameSettings, "GetQuota", null, "the loan shark's daily demand");
```

A failed lookup is data, not an exception. The mod that needed it reports
`needs GameSettings.GetQuota, which this game build does not expose`, greys out, and every
other mod carries on.

## Layers

```
Plugin.cs            BepInEx entry; resolves bindings, registers mods, spawns the controller
Core/
  GameBridge         all 23 named handles into the game, resolved once, reported honestly
  Reflect            finding things by shape when a name is not known
  RunState           the live run and the save files — two very different things
  Mod                base class: options, actions, authority, dynamic patching, fault latching
  ModRegistry        registration and the per-frame fan-out
  Options            typed, serialisable settings
  ConfigStore        atomic persistence and named profiles
  Json / JsonField   dependency-free serialisation; JsonField is Unity-free and unit-tested
  InputBridge        legacy Input or the Input System, whichever the game left enabled
UI/
  Draw               rounded rects, shadows, geometric icons — no shipped image assets
  Theme / Styles     five palettes; GUIStyles built on the first OnGUI
  Widgets            switches, sliders, dropdowns, colour, key capture
  Pages              the right-hand pane
  MenuController     window chrome, input, and the frame pump
  Hud                the always-on overlay, shared so mods do not overdraw each other
Mods/                33 mods, registered in Catalogue.cs
```

## Things that are the way they are for a reason

**Patches are applied and removed on toggle.** `Mod.Patches()` yields specs whose targets come
from `GameBridge`, and `Harmony.UnpatchSelf()` runs on disable. A mod that is off is genuinely
not in the call path, rather than a patch that runs and checks a boolean forever.

**A mod that throws is latched off.** `Mod.Trip` records the fault, disables the mod, removes
its patches and tells the user once. Without that, a mod throwing in `OnUpdate` throws every
frame — filling the log and stuttering the game.

**Authority is checked live, not at registration.** `BlockedReason()` is recomputed every
frame because lobby state changes underneath it: you can host, then join a friend, without
restarting the game.

**`Draw.Alpha` exists because `GUI.color` does not work here.** The `GUI.DrawTexture` overload
that provides rounded corners takes an explicit colour argument and ignores `GUI.color`, so a
fade driven that way animates the text and leaves every surface at full opacity.

**Overlays are deferred, and track their group offset.** A dropdown must paint over content
drawn after it, so it queues a closure flushed at the end of the frame — by which time every
`GUI.BeginGroup` has closed, so the rect it captured has to have the group origin added back.

**Scene loads drop the instance cache.** `FindObjectOfType` is far too slow to call per frame,
so results are cached; Unity's overloaded equality means a destroyed object is non-null to
`ReferenceEquals` but null to `==`, so the cache is validated with the Unity comparison.

**Save edits are text edits.** `JsonField` rewrites one value in place. Deserialising would
need the game's `SaveData` type and would silently drop every field the plugin has never heard
of. The key search also refuses to match a substring of a longer key, so editing `money` never
touches `prestigeMoney` — there is a test for exactly that.
