using System;
using System.Collections.Generic;
using UnityEngine;

namespace GambleMenu.Core
{
    internal enum ToastKind { Info, Success, Warn, Error }

    internal sealed class Toast
    {
        public string Message;
        public ToastKind Kind;
        public float Born;      // unscaled time, so toasts still expire while the game is paused
        public float Lifetime;
        public int Repeats = 1;
    }

    /// <summary>
    /// The plugin's only channel for telling the user something happened.
    ///
    /// Nothing in here fails quietly: a refused toggle, a faulted mod and a rejected value
    /// all surface as a toast, because a mod menu that silently ignores a click is
    /// indistinguishable from a broken one.
    /// </summary>
    internal static class Notifier
    {
        private const int MaxVisible = 5;
        private static readonly List<Toast> _toasts = new List<Toast>();

        public static IReadOnlyList<Toast> Active => _toasts;

        public static void Info(string message)    => Push(message, ToastKind.Info, 3.5f);
        public static void Success(string message) => Push(message, ToastKind.Success, 3.5f);
        public static void Warn(string message)    => Push(message, ToastKind.Warn, 5f);
        public static void Error(string message)   => Push(message, ToastKind.Error, 7f);

        private static void Push(string message, ToastKind kind, float lifetime)
        {
            if (string.IsNullOrEmpty(message)) return;

            // Collapse a repeat of the newest toast rather than stacking duplicates; a mod
            // refusing once per frame would otherwise fill the screen.
            if (_toasts.Count > 0)
            {
                var last = _toasts[_toasts.Count - 1];
                if (last.Message == message && last.Kind == kind)
                {
                    last.Repeats++;
                    last.Born = Time.unscaledTime;
                    return;
                }
            }

            _toasts.Add(new Toast
            {
                Message = message,
                Kind = kind,
                Born = Time.unscaledTime,
                Lifetime = lifetime
            });

            while (_toasts.Count > MaxVisible) _toasts.RemoveAt(0);
            Log.Info($"toast[{kind}] {message}");
        }

        public static void Prune()
        {
            float now = Time.unscaledTime;
            for (int i = _toasts.Count - 1; i >= 0; i--)
                if (now - _toasts[i].Born > _toasts[i].Lifetime) _toasts.RemoveAt(i);
        }

        public static void Clear() => _toasts.Clear();
    }
}
