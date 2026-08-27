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
        public const string Version = "1.0.0";

        private GameObject _host;

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
