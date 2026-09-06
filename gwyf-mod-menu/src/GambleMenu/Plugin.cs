using System;
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

        private void Awake()
        {
            Log.Bind(Logger);
            Log.Info($"GambleMenu {Version} starting");

            try
            {
                // Resolving bindings is the one step that touches the game, so it is the one
                // most likely to be surprised by it — and it used to be able to end the whole
                // plugin. An ambiguous method name did exactly that: the menu never appeared,
                // on every launch, and the only sign was one line in this log.
                //
                // Nothing here is worth the menu. A binding layer that fails now costs the mods
                // that needed those bindings and nothing else.
                try { GameBridge.Resolve(); }
                catch (Exception ex) { Log.Error($"binding resolution failed; mods that need the game will be unavailable: {ex}"); }

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

                // Discovery is deliberately NOT run here. It walks every type in every game
                // assembly and every component in the scene, and running that unasked during
                // Awake crashed the game on the first machine it ever reached. A diagnostic is
                // not worth the thing it is diagnosing: it is a button on the Compatibility
                // page now, pressed when someone wants it, with the game already up.

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
