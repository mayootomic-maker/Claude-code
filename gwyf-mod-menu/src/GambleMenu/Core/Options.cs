using System;
using System.Collections.Generic;
using System.Globalization;
using UnityEngine;

namespace GambleMenu.Core
{
    /// <summary>
    /// One persisted, user-editable setting belonging to a <see cref="Mod"/>.
    ///
    /// Options serialise to strings because <see cref="ConfigStore"/> stores a flat map;
    /// every conversion goes through <see cref="CultureInfo.InvariantCulture"/> so a config
    /// written on a machine with comma decimal separators still loads on one without.
    /// </summary>
    internal abstract class Option
    {
        public string Key;
        public string Label;
        public string Tooltip;

        /// <summary>Optional predicate; when it returns false the option is hidden from the
        /// panel. Used to collapse settings that only matter while a parent toggle is on.</summary>
        public Func<bool> VisibleWhen;

        /// <summary>Raised after the value changes, whether from the UI or a config load.</summary>
        public event Action Changed;

        public bool Visible => VisibleWhen == null || VisibleWhen();

        public abstract string Serialize();
        public abstract void Deserialize(string raw);
        public abstract void ResetToDefault();
        public abstract bool IsDefault { get; }

        protected void RaiseChanged() => Changed?.Invoke();
    }

    internal sealed class BoolOption : Option
    {
        private bool _value;
        public readonly bool DefaultValue;

        public BoolOption(string key, string label, bool defaultValue, string tooltip = null)
        {
            Key = key; Label = label; Tooltip = tooltip;
            DefaultValue = defaultValue; _value = defaultValue;
        }

        public bool Value
        {
            get => _value;
            set { if (_value == value) return; _value = value; RaiseChanged(); }
        }

        public override string Serialize() => _value ? "true" : "false";
        public override void Deserialize(string raw) => Value = raw == "true" || raw == "1";
        public override void ResetToDefault() => Value = DefaultValue;
        public override bool IsDefault => _value == DefaultValue;
    }

    internal sealed class FloatOption : Option
    {
        private float _value;
        public readonly float DefaultValue, Min, Max;
        /// <summary>Step to snap to, or 0 for continuous.</summary>
        public float Step;
        /// <summary>Numeric format for display, e.g. "0.00" or "0.0x".</summary>
        public string Format = "0.##";
        /// <summary>Appended to the displayed value, e.g. "s" or "%".</summary>
        public string Unit = "";

        public FloatOption(string key, string label, float defaultValue, float min, float max, string tooltip = null)
        {
            Key = key; Label = label; Tooltip = tooltip;
            DefaultValue = defaultValue; Min = min; Max = max;
            _value = defaultValue;
        }

        public float Value
        {
            get => _value;
            set
            {
                float v = Mathf.Clamp(value, Min, Max);
                if (Step > 0f) v = Mathf.Round(v / Step) * Step;
                if (Mathf.Approximately(_value, v)) return;
                _value = v;
                RaiseChanged();
            }
        }

        public string Display => _value.ToString(Format, CultureInfo.InvariantCulture) + Unit;

        public override string Serialize() => _value.ToString("R", CultureInfo.InvariantCulture);
        public override void Deserialize(string raw)
        {
            if (float.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out float v)) Value = v;
        }
        public override void ResetToDefault() => Value = DefaultValue;
        public override bool IsDefault => Mathf.Approximately(_value, DefaultValue);
    }

    internal sealed class IntOption : Option
    {
        private int _value;
        public readonly int DefaultValue, Min, Max;
        public string Unit = "";

        public IntOption(string key, string label, int defaultValue, int min, int max, string tooltip = null)
        {
            Key = key; Label = label; Tooltip = tooltip;
            DefaultValue = defaultValue; Min = min; Max = max;
            _value = defaultValue;
        }

        public int Value
        {
            get => _value;
            set { int v = Mathf.Clamp(value, Min, Max); if (_value == v) return; _value = v; RaiseChanged(); }
        }

        public override string Serialize() => _value.ToString(CultureInfo.InvariantCulture);
        public override void Deserialize(string raw)
        {
            if (int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out int v)) Value = v;
        }
        public override void ResetToDefault() => Value = DefaultValue;
        public override bool IsDefault => _value == DefaultValue;
    }

    /// <summary>
    /// A 64-bit setting edited as text rather than a slider.
    ///
    /// The game stores money and quota as <c>long</c>, and the interesting values span
    /// twelve orders of magnitude — a slider cannot address that range usefully, so this
    /// carries a text buffer plus preset shortcuts instead.
    /// </summary>
    internal sealed class LongOption : Option
    {
        private long _value;
        public readonly long DefaultValue, Min, Max;
        /// <summary>Live text buffer; kept separate so a half-typed value never clobbers state.</summary>
        public string Buffer;
        public long[] Presets = Array.Empty<long>();

        public LongOption(string key, string label, long defaultValue, long min, long max, string tooltip = null)
        {
            Key = key; Label = label; Tooltip = tooltip;
            DefaultValue = defaultValue; Min = min; Max = max;
            _value = defaultValue; Buffer = defaultValue.ToString(CultureInfo.InvariantCulture);
        }

        public long Value
        {
            get => _value;
            set
            {
                long v = value < Min ? Min : (value > Max ? Max : value);
                if (_value == v) return;
                _value = v;
                Buffer = v.ToString(CultureInfo.InvariantCulture);
                RaiseChanged();
            }
        }

        /// <summary>Parses the text buffer into <see cref="Value"/>. Returns false when the
        /// buffer is not a number, so the UI can mark the field rather than silently reverting.</summary>
        public bool CommitBuffer()
        {
            string cleaned = (Buffer ?? string.Empty).Replace(",", "").Replace("_", "").Replace(" ", "").Trim();
            if (cleaned.Length == 0) return false;
            if (!long.TryParse(cleaned, NumberStyles.Integer, CultureInfo.InvariantCulture, out long v)) return false;
            Value = v;
            return true;
        }

        public override string Serialize() => _value.ToString(CultureInfo.InvariantCulture);
        public override void Deserialize(string raw)
        {
            if (long.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out long v)) Value = v;
        }
        public override void ResetToDefault() => Value = DefaultValue;
        public override bool IsDefault => _value == DefaultValue;
    }

    internal sealed class EnumOption : Option
    {
        private int _index;
        public readonly int DefaultIndex;
        public readonly string[] Choices;

        public EnumOption(string key, string label, string[] choices, int defaultIndex, string tooltip = null)
        {
            Key = key; Label = label; Tooltip = tooltip;
            Choices = choices; DefaultIndex = defaultIndex; _index = defaultIndex;
        }

        public int Index
        {
            get => _index;
            set { int v = Mathf.Clamp(value, 0, Choices.Length - 1); if (_index == v) return; _index = v; RaiseChanged(); }
        }

        public string Selected => Choices[_index];

        public override string Serialize() => Choices[_index];
        public override void Deserialize(string raw)
        {
            for (int i = 0; i < Choices.Length; i++)
                if (string.Equals(Choices[i], raw, StringComparison.Ordinal)) { Index = i; return; }
        }
        public override void ResetToDefault() => Index = DefaultIndex;
        public override bool IsDefault => _index == DefaultIndex;
    }

    internal sealed class ColorOption : Option
    {
        private Color _value;
        public readonly Color DefaultValue;

        public ColorOption(string key, string label, Color defaultValue, string tooltip = null)
        {
            Key = key; Label = label; Tooltip = tooltip;
            DefaultValue = defaultValue; _value = defaultValue;
        }

        public Color Value
        {
            get => _value;
            set { if (_value == value) return; _value = value; RaiseChanged(); }
        }

        public override string Serialize() =>
            string.Format(CultureInfo.InvariantCulture, "{0:R},{1:R},{2:R},{3:R}", _value.r, _value.g, _value.b, _value.a);

        public override void Deserialize(string raw)
        {
            var parts = (raw ?? string.Empty).Split(',');
            if (parts.Length != 4) return;
            if (float.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out float r) &&
                float.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out float g) &&
                float.TryParse(parts[2], NumberStyles.Float, CultureInfo.InvariantCulture, out float b) &&
                float.TryParse(parts[3], NumberStyles.Float, CultureInfo.InvariantCulture, out float a))
                Value = new Color(r, g, b, a);
        }

        public override void ResetToDefault() => Value = DefaultValue;
        public override bool IsDefault => _value == DefaultValue;
    }

    internal sealed class KeyOption : Option
    {
        private KeyCode _value;
        public readonly KeyCode DefaultValue;

        public KeyOption(string key, string label, KeyCode defaultValue, string tooltip = null)
        {
            Key = key; Label = label; Tooltip = tooltip;
            DefaultValue = defaultValue; _value = defaultValue;
        }

        public KeyCode Value
        {
            get => _value;
            set { if (_value == value) return; _value = value; RaiseChanged(); }
        }

        public bool IsBound => _value != KeyCode.None;
        public string Display => _value == KeyCode.None ? "—" : _value.ToString();

        public override string Serialize() => _value.ToString();
        public override void Deserialize(string raw)
        {
            if (Enum.TryParse(raw, out KeyCode k)) Value = k;
        }
        public override void ResetToDefault() => Value = DefaultValue;
        public override bool IsDefault => _value == DefaultValue;
    }

    internal sealed class StringOption : Option
    {
        private string _value;
        public readonly string DefaultValue;
        public string Placeholder = "";

        public StringOption(string key, string label, string defaultValue, string tooltip = null)
        {
            Key = key; Label = label; Tooltip = tooltip;
            DefaultValue = defaultValue ?? string.Empty; _value = DefaultValue;
        }

        public string Value
        {
            get => _value;
            set { string v = value ?? string.Empty; if (_value == v) return; _value = v; RaiseChanged(); }
        }

        public override string Serialize() => _value;
        public override void Deserialize(string raw) => Value = raw;
        public override void ResetToDefault() => Value = DefaultValue;
        public override bool IsDefault => string.Equals(_value, DefaultValue, StringComparison.Ordinal);
    }
}
