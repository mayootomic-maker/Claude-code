# The Descent

What happens when you miss quota, instead of the run simply ending.

This is a design record, not a plan of intent: every hook named below was read out of
the game's own assembly, and every line marked **unknown** is something nobody has
confirmed yet. It exists so the sequence can be argued about before it is built.

## The sequence

Beat by beat, as specified.

| # | Beat | Where it attaches | Confidence |
|---|------|-------------------|-----------|
| 1 | The day timer runs out under quota | `GameManager.state = GameState.Lose` | **certain** |
| 2 | You are driven away exactly as you are today | `ServerChangeScene("LoseStateScene")` | **certain** |
| 3 | The day's figures come up — how well you did | `DaySummaryUI` | **certain** |
| 4 | Screens go black. Punching. No death. | our own overlay + audio | **certain** |
| 5 | The dynamite goes off, the floor gives way, you fall | inside `LoseStateScene` | **unknown** |
| 6 | You wake chained to each other, in a cave | our scene content | **buildable** |
| 7 | A short parkour, chained, out of the cave | our scene content + `ServerKnockback` | **buildable** |
| 8 | You come out directly in the boss's office | `ElevatorManager` index 5, `"BossRoom"` | **likely** |
| 9 | You work for them again: a stake, and a higher quota | `SaveData`, `GameManager.currentQuota` | **certain** |
| 10 | Or you both hold a button, give up, and rot | our input + `SaveManager.ResetCurrentSaveToDefaults()` | **certain** |

## What the game already gives us

**The lose path is one line, and it is the server's.**

```csharp
case GameState.Lose:
    NetworkManager.singleton.ServerChangeScene("LoseStateScene");
```

and immediately after, the thing that currently ends the run:

```csharp
if (state == GameState.Lose || state == GameState.Summary)
{
    SaveManager.Instance.ResetCurrentSaveToDefaults();
    SaveManager.Instance.LoadGame();
}
```

That reset is not an obstacle — it *is* beat 10. Giving up already does exactly what
was asked for: back to day one. The Descent's job is to stand between beat 2 and that
reset and offer a way out first. Suppressing it is a prefix; running it is doing
nothing.

**The chain is a force, not a joint.** `PlayerController` is Rigidbody-driven and the
server can push it:

```csharp
[Server] public void ServerKnockback(Vector3 force, Vector3 torque)
[Server] public void ServerTeleport(Vector3 position)
[Server] public void ServerLock(bool isLocked)
```

So the tether is measured on the host each tick and applied as a pull to whichever
player is too far out. It will not behave like a real rope — clients simulate their own
bodies, so there will be rubber under load — but the thing the idea is actually for,
being yanked off a ledge by a friend who jumped, is exactly what this produces.

**The bat is already a weapon.** `Bat : ConsumableItem` carries a hit collider, an
animator, hit VFX, `power`, `upPower`, `torquePower`, and a `breakChance` of 0.15. The
boss fight does not need a new weapon; it needs something worth swinging at.

**There is already a boss room.** `ElevatorManager` maps floor 5 to `"BossRoom"`, and
`BossGame` exists but is a stub whose win condition is a `Debug.Log`. The office at the
end of the parkour is a room the game ships and does not really use.

## What nobody knows yet

**The dynamite.** It is not in the assembly. It is animation or timeline inside
`LoseStateScene`, so beat 5 cannot be timed against it until someone has looked at that
scene from inside a running game. Until then the collapse is triggered on our own clock
after the summary, which is a beat late rather than wrong.

**Every material and mesh in the game.** The assembly names the game's *code*, not its
*art*. So "the cave must not stand out" cannot be satisfied by choosing colours here —
they would be invented, which is precisely how the current menu ended up looking like a
mod.

The way out is not to author the look at all. The cave is assembled from primitives at
runtime and then dressed in materials **harvested from the game's own loaded scenes** —
found by shader and name at the moment the cave is built. The game's concrete is the
cave's concrete, its lighting model is the cave's lighting model. Nothing to match
because nothing is new.

That harvest is also the last thing the discovery dump was written for: it lists every
material, shader, font and colour the game is drawing with. One run of it turns the cave
from guesswork into fitting.

## Open questions

- **How long is "not too long"?** Assumed: 90 seconds for a competent pair, no fail
  state except giving up. Falling costs progress, not the run.
- **What does the second quota cost?** Assumed: the stake is a fraction of what was owed
  and the new demand is strictly above the missed one, so the escape is a worse deal
  than not falling — otherwise losing becomes the good outcome.
- **Can the give-up button be held alone?** Assumed no: both players, together, held.
  Solo lobbies need a separate answer.
- **Does the boss fight gate the cave, or replace the coin flip?** Two different games.
  Unresolved.

## Easter eggs

Deliberately not listed. Written down in a document that gets read, they stop being
easter eggs. They go in the code, unannounced.
