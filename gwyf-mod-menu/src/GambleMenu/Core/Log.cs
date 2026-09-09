using BepInEx.Logging;

namespace GambleMenu.Core
{
    /// <summary>Thin funnel to the BepInEx log so no file in the plugin has to hold a
    /// reference to the plugin instance just to report something.</summary>
    internal static class Log
    {
        private static ManualLogSource _source;

        public static void Bind(ManualLogSource source) => _source = source;

        public static void Info(string message)  => _source?.LogInfo(message);
        public static void Warn(string message)  => _source?.LogWarning(message);
        public static void Error(string message) => _source?.LogError(message);
        public static void Debug(string message) => _source?.LogDebug(message);
    }
}
