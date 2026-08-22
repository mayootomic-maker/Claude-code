; Inno Setup script for the Accent Voice Changer.
; Build with:  iscc packaging\installer.iss
; Expects PyInstaller output in dist\AccentVoiceChanger\.

#define AppName        "Accent Voice Changer"
#define AppShortName   "AccentVoiceChanger"
#define AppPublisher   "Accent Voice Changer contributors"
#define AppURL         "https://github.com/mayootomic-maker/claude-code"
#define AppExe         "AccentVoiceChanger.exe"
#define CliExe         "ravc.exe"
#ifndef AppVersion
  #define AppVersion   "1.0.0"
#endif
#define SourceDir      "..\dist\AccentVoiceChanger"

[Setup]
AppId={{7F2C1E64-9C1B-4F0E-9E2E-2B8A6E5D4A11}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
LicenseFile=..\LICENSE
OutputDir=..\dist
OutputBaseFilename={#AppShortName}-Setup-{#AppVersion}
SetupIconFile=..\assets\ravc.ico
UninstallDisplayIcon={app}\{#AppExe}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
MinVersion=10.0
DisableDirPage=no
ShowLanguageDialog=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; \
    GroupDescription: "Additional shortcuts:"
Name: "addtopath"; Description: "Add the ""ravc"" command to PATH"; \
    GroupDescription: "Command line:"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; \
    Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\{#AppName} on the web"; Filename: "{#AppURL}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; \
    Tasks: desktopicon

[Registry]
; Only extend PATH when the user asked for it; never rewrite it wholesale.
Root: HKCU; Subkey: "Environment"; ValueType: expandsz; ValueName: "Path"; \
    ValueData: "{olddata};{app}"; Tasks: addtopath; \
    Check: NeedsAddPath(ExpandConstant('{app}'))

[Run]
Filename: "{app}\{#AppExe}"; Description: "Launch {#AppName}"; \
    Flags: nowait postinstall skipifsilent
Filename: "https://vb-audio.com/Cable/"; \
    Description: "Get VB-CABLE (needed to be heard in Discord, Zoom, OBS or games)"; \
    Flags: shellexec nowait postinstall skipifsilent unchecked

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
// True when the given directory is not already on the user's PATH.
// Note: use // here, not { }. In Pascal a brace opens a comment, so a
// constant like {app} inside one closes it early and the rest of the line
// becomes stray code -- which is exactly what broke this compile.
function NeedsAddPath(Param: string): Boolean;
var
  OrigPath: string;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path',
                             OrigPath) then
  begin
    Result := True;
    exit;
  end;
  Result := Pos(';' + Uppercase(Param) + ';',
                ';' + Uppercase(OrigPath) + ';') = 0;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpWelcome then
    WizardForm.WelcomeLabel2.Caption :=
      'This will install ' + '{#AppName}' + ' ' + '{#AppVersion}' + '.' + #13#10 + #13#10 +
      'Speak English and come out sounding Russian or German. Everything ' +
      'runs on this machine; nothing is uploaded.' + #13#10 + #13#10 +
      'After installing, open the app and download one voice model ' +
      '(about 60 MB) from the Models tab. To be heard in Discord, Zoom, ' +
      'OBS or a game you also need a free virtual audio cable — the last ' +
      'page of this installer links to it.';
end;
