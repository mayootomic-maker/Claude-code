using System.Collections.Generic;
using GambleMenu.Core;
using GambleMenu.UI;
using UnityEngine;
using Object = UnityEngine.Object;

namespace GambleMenu.Mods
{
    internal sealed class LobbyReadout : Mod
    {
        public override string Id => "session.lobby";
        public override string Name => "Lobby readout";
        public override string Description => "Who is connected, and whether this machine is the host.";
        public override Category Cat => Category.Session;
        public override string[] Tags => new[] { "lobby", "players", "host", "network", "mirror" };

        protected override void OnDrawOverlay()
        {
            if (!GameBridge.IsConnected)
            {
                Hud.Line("lobby   not connected");
                return;
            }
            Hud.Line($"lobby   {(GameBridge.IsHost ? "hosting" : "guest")}, {GameBridge.PlayerCount} player(s)");
        }
    }

    /// <summary>
    /// Explains, in the menu, why a host-only mod is refusing.
    ///
    /// The refusal already appears on each card, but a player who has just joined a friend's
    /// lobby and finds half the menu greyed out benefits from one place that says why, rather
    /// than inferring it from six identical messages.
    /// </summary>
    internal sealed class AuthorityStatus : Mod
    {
        public override string Id => "session.authority";
        public override string Name => "Why is something greyed out?";
        public override string Description => "Explains the host-only rule and shows what it is blocking right now.";
        public override Category Cat => Category.Session;
        public override bool IsToggle => false;
        public override string[] Tags => new[] { "host", "client", "blocked", "greyed", "desync", "authority" };

        protected override void Build()
        {
            Act("Explain my current role", () =>
            {
                if (!GameBridge.IsConnected)
                {
                    Notifier.Info("You are not in a lobby, so nothing is blocked. Host-only mods will work once you host.");
                    return;
                }
                if (GameBridge.IsHost)
                {
                    Notifier.Success($"You are the host of a {GameBridge.PlayerCount}-player lobby. Everything is available.");
                    return;
                }
                Notifier.Warn("You are a guest. The host's machine owns money, quota and floor, so writing them here would be overwritten on the next sync — or desync your run. Local mods still work.");
            });

            Act("List what is blocked", () =>
            {
                var blocked = new List<string>();
                foreach (var mod in ModRegistry.All)
                {
                    if (mod == this) continue;
                    if (mod.BlockedReason() != null) blocked.Add(mod.Name);
                }
                Notifier.Info(blocked.Count == 0
                    ? "Nothing is blocked right now."
                    : $"{blocked.Count} blocked: {string.Join(", ", blocked.ToArray())}");
            });
        }
    }
}
