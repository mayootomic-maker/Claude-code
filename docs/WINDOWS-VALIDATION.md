# Windows validation register

Everything that compiles and unit-tests on Linux but has **never executed against real
Windows**. Nothing on this list may be described as "working".

This file exists because a marker that nothing collects gets ignored within a few sessions.
`REQUIRES-WINDOWS-VALIDATION` in a council transcript is not a record — a row here is.

`/council-prerelease` counts open CRITICAL rows. **READY-FOR-WINDOWS-VALIDATION is impossible
while any CRITICAL row is open**, and `SHIP` is not a verdict this environment can produce at
all.

## How to add a row

| Column | Meaning |
|---|---|
| **What is unverified** | The specific behaviour, not the component |
| **Windows test that resolves it** | Concrete enough that someone else could run it |
| **Protects** | The file or ADR that depends on this being true |
| **Severity** | CRITICAL / HIGH / MEDIUM / LOW |

Severity is about consequence-if-wrong, not effort-to-test:

- **CRITICAL** — could leave the user's system in a modified state, lose their data, or
  produce a confidently wrong diagnosis
- **HIGH** — a core feature silently does not work
- **MEDIUM** — degraded behaviour with a visible symptom
- **LOW** — cosmetic or convenience

## Open

| What is unverified | Windows test that resolves it | Protects | Severity |
|---|---|---|---|
| _(nothing built yet)_ | | | |

## Resolved

| What was unverified | How it was resolved | Date |
|---|---|---|
| WPF compiles from a Linux host | Built a scratch `net8.0-windows` WPF project with `EnableWindowsTargeting=true`; `dotnet build -c Release` succeeded, 0 warnings | 2026-08-23 |
