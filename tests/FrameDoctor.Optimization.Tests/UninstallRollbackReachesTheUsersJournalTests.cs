using System.Xml.Linq;
using Xunit;
using Shouldly;

namespace FrameDoctor.Optimization.Tests;

/// <summary>
/// Adversarial: the uninstall-time rollback must be able to see the journal it is undoing.
/// </summary>
/// <remarks>
/// <para>
/// The rollback journal lives in <c>Environment.SpecialFolder.LocalApplicationData</c> — a
/// <b>per-user</b> directory (<c>src/FrameDoctor.Engine/Program.cs</c>, <c>JournalPath</c>).
/// </para>
/// <para>
/// The installer's <c>ReconcileBeforeUninstall</c> custom action is declared
/// <c>Execute="deferred" Impersonate="no"</c>, which runs it as <c>NT AUTHORITY\SYSTEM</c>.
/// SYSTEM's LocalApplicationData is
/// <c>C:\Windows\system32\config\systemprofile\AppData\Local</c>, so the action reads an empty
/// journal, prints "FrameDoctor has not changed anything on this machine", returns 0 — and then
/// the uninstaller deletes the only executable that knew how to put the user's settings back.
/// </para>
/// <para>
/// That is precisely the outcome the comment above the action says it exists to prevent. Either
/// the action impersonates the user, or the journal has to live somewhere SYSTEM can find every
/// user's copy of it. This test pins the first, because the journal being per-user is the thing
/// that keeps the mutation unelevated.
/// </para>
/// </remarks>
public sealed class UninstallRollbackReachesTheUsersJournalTests
{
    private static XDocument LoadInstaller()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null &&
               !File.Exists(Path.Combine(directory.FullName, "packaging", "FrameDoctor.wxs")))
        {
            directory = directory.Parent;
        }

        directory.ShouldNotBeNull("packaging/FrameDoctor.wxs was not found above the test binary");
        return XDocument.Load(Path.Combine(directory.FullName, "packaging", "FrameDoctor.wxs"));
    }

    [Fact]
    public void The_uninstall_reconcile_runs_as_the_user_whose_journal_it_reads()
    {
        var action = LoadInstaller()
            .Descendants()
            .Single(e => e.Name.LocalName == "CustomAction" &&
                         (string?)e.Attribute("Id") == "ReconcileBeforeUninstall");

        // Impersonate="no" runs as SYSTEM, whose LocalApplicationData is not the user's, so the
        // journal the action reads is always empty and the user's machine stays modified.
        ((string?)action.Attribute("Impersonate")).ShouldNotBe(
            "no",
            "uninstall rollback runs as SYSTEM and cannot see the per-user rollback journal");
    }
}
