using System;
using System.Collections;
using BepInEx;
using GambleMenu.Core;
using GambleMenu.Mods;
using GambleMenu.UI;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace GambleMenu
{
    [BepInPlugin(Guid, "GambleMenu", Version)]
    public sealed class Plugin : BaseUnityPlugin
    {
        public const string Guid = "com.claude.gamblemenu";
        /// <summary>
        /// Shown in the menu header, the startup banner and the startup report.
        ///
        /// Kept in step with the installer and the Thunderstore manifest deliberately: it sat
        /// at 1.0.0 through twenty-two commits, which meant a freshly installed build and a
        /// stale one looked identical from inside the game.
        /// </summary>
        public const string Version = "1.2.0";

        private GameObject _host;
        private bool _sceneDiscoveryDone;

        private void Awake()
        {
            Log.Bind(Logger);
            Log.Info($"GambleMenu {Version} starting");

            try
            {
                GameBridge.Resolve();
                Catalogue.RegisterAll();

                ConfigStore.EnsureDirectories();
                ConfigStore.LoadActive();

                _host = new GameObject("GambleMenu.Controller");
                _host.hideFlags = HideFlags.HideAndDontSave;
                DontDestroyOnLoad(_host);
                _host.AddComponent<MenuController>();

                // Scene changes destroy every cached scene reference. Dropping the cache here
                // is cheaper and far more reliable than each mod null-checking its own.
                SceneManager.sceneLoaded += OnSceneLoaded;

                // Written every launch, unprompted: "it does not work" and "it works" look
                // identical from outside the game, and this is the one file that separates them.
                Diagnostics.WriteStartupReport(Version);

                // The startup report says which of this plugin's guesses failed. This says what
                // the right answers were, which is the only way the guessing ends.
                Discovery.WriteAll(Version);

                Log.Info($"ready — {ModRegistry.All.Count} mods registered, press {Settings.MenuKey.Value} to open");
            }
            catch (Exception ex)
            {
                // A plugin that throws in Awake takes no further part in the session, so say
                // so loudly rather than leaving the user wondering why no menu appears.
                Log.Error($"GambleMenu failed to start and is inactive: {ex}");
            }
        }

        private void OnSceneLoaded(Scene scene, LoadSceneMode mode)
        {
            GameBridge.InvalidateInstances();
            if (Settings.VerboseLog.Value) Log.Info($"scene '{scene.name}' loaded — instance cache dropped");

            // The dump written in Awake catches the type map but an empty scene: no floor, no
            // machines, no interface to read colours off. The first scene the game loads has
            // all three, so it is worth the one repeat — during a loading screen, once.
            if (!_sceneDiscoveryDone)
            {
                _sceneDiscoveryDone = true;
                Discovery.WriteAll(Version);
                StartCoroutine(RewriteDiscoveryOncePopulated());
            }
        }

        /// <summary>
        /// Takes the dump a second time once the floor has filled in.
        ///
        /// A scene finishes loading before the things worth describing exist: machines and
        /// players are spawned over the network a moment later, and the interface is built
        /// after that. The dump written at sceneLoaded can therefore describe an empty room.
        ///
        /// The menu has a button for taking another, which is the answer when the menu opens.
        /// It is no answer at all when it does not — which is the report this was written for —
        /// so the second pass happens whether anyone asks for it or not.
        /// </summary>
        private IEnumerator RewriteDiscoveryOncePopulated()
        {
            // Unscaled: the game may well be paused behind a loading screen for some of this.
            yield return new WaitForSecondsRealtime(25f);
            Discovery.WriteAll(Version);
        }

        private void OnDestroy()
        {
            SceneManager.sceneLoaded -= OnSceneLoaded;

            // Leaving Harmony patches installed after the plugin object dies would leave the
            // game running our code with no state behind it.
            ModRegistry.DisableAll(quiet: true);
            try { ConfigStore.SaveActive(); }
            catch (Exception ex) { Log.Error($"could not save settings on shutdown: {ex.Message}"); }

            if (_host != null) Destroy(_host);
        }
    }
}
