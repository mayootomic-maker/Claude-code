using GambleMenu.Core;

namespace GambleMenu.Mods
{
    /// <summary>
    /// The registration list. Order within a category is the order the cards appear, so the
    /// mods people reach for first are listed first.
    /// </summary>
    internal static class Catalogue
    {
        public static void RegisterAll()
        {
            // Economy — the shared bank account and the loan shark's demand.
            ModRegistry.Add(new NeverLose());
            ModRegistry.Add(new InfiniteMoney());
            ModRegistry.Add(new BalanceEditor());
            ModRegistry.Add(new WinningsMultiplier());
            ModRegistry.Add(new LossProtection());
            ModRegistry.Add(new BalanceFloor());
            ModRegistry.Add(new QuotaFreeze());
            ModRegistry.Add(new QuotaEditor());

            // Discreet economy: the same effects shaped to look like variance.
            ModRegistry.Add(new LuckyStreak());
            ModRegistry.Add(new DripFeed());

            // Machines — reading what one is about to do.
            ModRegistry.Add(new TableRead());
            ModRegistry.Add(new TileRead());
            ModRegistry.Add(new RandomControl());

            // Time — how long a day lasts and how fast it runs.
            ModRegistry.Add(new DayLength());
            ModRegistry.Add(new FreezeDayTimer());
            ModRegistry.Add(new GameSpeed());

            // Progression — the tower.
            ModRegistry.Add(new FloorAccess());
            ModRegistry.Add(new HoldFloor());
            ModRegistry.Add(new SurvivedDays());

            // Saves — the same numbers, but on disk and permanent.
            ModRegistry.Add(new SaveEditor());
            ModRegistry.Add(new SaveBackups());

            // Player — local movement only.
            ModRegistry.Add(new Noclip());
            ModRegistry.Add(new MovementTuning());
            ModRegistry.Add(new Waypoints());
            ModRegistry.Add(new FreeCamera());
            ModRegistry.Add(new ThirdPerson());
            ModRegistry.Add(new PlayerReadout());

            // Visuals — nothing here touches game state.
            ModRegistry.Add(new RunHud());
            ModRegistry.Add(new PlayerEsp());
            ModRegistry.Add(new ObjectFinder());
            ModRegistry.Add(new Fullbright());
            ModRegistry.Add(new NoFog());
            ModRegistry.Add(new FieldOfView());
            ModRegistry.Add(new Zoom());
            ModRegistry.Add(new CleanScreen());
            ModRegistry.Add(new Crosshair());

            // Performance — local rendering only.
            ModRegistry.Add(new Performance());

            // Automation.
            ModRegistry.Add(new AutoPress());
            ModRegistry.Add(new SignalAutoPress());
            ModRegistry.Add(new KeySequence());
            ModRegistry.Add(new AutoBackup());

            // Session.
            ModRegistry.Add(new LobbyReadout());
            ModRegistry.Add(new AuthorityStatus());

            // Developer — discovery tools for everything the bindings above do not cover.
            ModRegistry.Add(new ValueFinder());
            ModRegistry.Add(new MethodInvoker());
            ModRegistry.Add(new ComponentToggler());
            ModRegistry.Add(new ValueGraph());
            ModRegistry.Add(new AssemblyDumper());
            ModRegistry.Add(new FieldEditor());
            ModRegistry.Add(new NetworkedObjectList());
        }
    }
}
