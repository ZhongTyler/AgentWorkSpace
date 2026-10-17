param(
    [Parameter(Mandatory=$true)][string]$TaskCommand,
    [Parameter(Mandatory=$true)][string]$TaskFolder
)
$ErrorActionPreference = 'Stop'
# Codex tears down a header helper's entire child Job. WMI creates this one
# reviewed same-user gateway outside that temporary Job. Its own owner handles
# govern lifetime; all business children still have kill-on-close Jobs.
$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0}
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine=$TaskCommand
    CurrentDirectory=$TaskFolder
    ProcessStartupInformation=$startup
}
if ($result.ReturnValue -ne 0) { throw 'Owned HTTP gateway launch failed' }
@{pid=[int]$result.ProcessId} | ConvertTo-Json -Compress
