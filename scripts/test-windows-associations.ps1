# Exercise the real NSIS install/upgrade/uninstall on a disposable CI runner.
# Never run this fixture against a user's desktop or an existing installation.
$ErrorActionPreference = 'Stop'
if ($env:CI -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
    throw 'This test requires a disposable Windows CI runner.'
}
$extensions = @('gpx', 'kml', 'fit', 'rte')
$classes = 'HKCU:\Software\Classes'
$installDir = Join-Path $env:RUNNER_TEMP 'Route Studio association test'
$installer = (Get-ChildItem 'release/Route-Studio-*-win-x64.exe' | Select-Object -First 1).FullName
if (!$installer) { throw 'Windows installer not found' }
foreach ($ext in $extensions) {
    if ((Test-Path "$classes\RouteStudio.$ext") -or
        (Test-Path "HKLM:\Software\Classes\RouteStudio.$ext")) {
        throw 'Refusing to test over an existing Route Studio registration.'
    }
}

function Assert-Equal($actual, $expected, $message) {
    if ($actual -cne $expected) { throw "$message (expected '$expected', received '$actual')" }
}
function Read-Value($key, $name) {
    if (Test-Path $key) { return (Get-Item $key).GetValue($name) }
    return $null
}
function Set-ClassValue($subkey, $name, $value, $kind = [Microsoft.Win32.RegistryValueKind]::String) {
    # Get-Item returns read-only RegistryKey handles. Open writable handles for fixture changes.
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\Classes\$subkey")
    try {
        $key.SetValue($name, $value, $kind)
    } finally {
        $key.Dispose()
    }
}
function Remove-ClassValue($subkey, $name) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Software\Classes\$subkey", $true)
    if (!$key) { return }
    try {
        $key.DeleteValue($name, $false)
    } finally {
        $key.Dispose()
    }
}
function User-Choice($ext) {
    $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.$ext\UserChoice"
    if (!(Test-Path $key)) { return '' }
    $item = Get-Item $key
    return (($item.GetValueNames() | Sort-Object | ForEach-Object {
        "$($_)=$($item.GetValue($_))"
    }) -join "`n")
}
function Run-Installer {
    $process = Start-Process -FilePath $installer -ArgumentList "/S /currentuser /D=$installDir" -PassThru -Wait
    Assert-Equal $process.ExitCode 0 'Installation failed'
}
function Assert-Defaults($prefix) {
    foreach ($ext in $extensions) {
        $expected = if ($prefix -eq 'RouteStudio.AssociationTest.First' -and $ext -eq 'rte') { $null } else { "$prefix.$ext" }
        Assert-Equal (Read-Value "$classes\.$ext" '') $expected "Default changed for .$ext"
        Assert-Equal (User-Choice $ext) $choices[$ext] "UserChoice changed for .$ext"
        Assert-Equal (Read-Value "$classes\.$ext\OpenWithProgids" 'RouteStudio.AssociationTest.Other') '' 'Another Open With entry changed'
    }
}
function Assert-Handlers {
    foreach ($ext in $extensions) {
        $progid = "$classes\RouteStudio.$ext"
        $verb = "$classes\SystemFileAssociations\.$ext\shell\RouteStudio.Open"
        $command = '"' + $installDir + '\Route Studio.exe" "%1"'
        Assert-Equal (Read-Value "$progid\shell\open\command" '') $command 'Invalid Open With command'
        Assert-Equal (Read-Value "$verb\command" '') $command 'Invalid context-menu command'
        Assert-Equal (Read-Value "$classes\.$ext\OpenWithProgids" "RouteStudio.$ext") '' 'Missing Open With candidate'
        Assert-Equal ((Get-Item $progid).GetValueKind('AllowSilentDefaultTakeOver').ToString()) 'None' 'Missing REG_NONE default-takeover protection'
    }
}

$backup = @{}
$choices = @{}
try {
    foreach ($ext in $extensions) {
        $key = "$classes\.$ext"
        $item = if (Test-Path $key) { Get-Item $key } else { $null }
        $backup[$ext] = @{
            present = $item -and ($item.GetValueNames() -contains '')
            value = if ($item) { $item.GetValue('') } else { $null }
            kind = if ($item -and ($item.GetValueNames() -contains '')) { $item.GetValueKind('') } else { $null }
        }
        $choices[$ext] = User-Choice $ext
        if ($ext -eq 'rte') {
            Remove-ClassValue ".$ext" ''
        } else {
            Set-ClassValue ".$ext" '' "RouteStudio.AssociationTest.First.$ext"
        }
        Set-ClassValue ".$ext\OpenWithProgids" 'RouteStudio.AssociationTest.Other' ''
    }
    Write-Host 'Verifying initial installation preserves defaults and other handlers.'
    Run-Installer
    Assert-Handlers
    Assert-Defaults 'RouteStudio.AssociationTest.First'

    # A user's later choice must survive an upgrade as well as removal.
    foreach ($ext in $extensions) {
        Set-ClassValue ".$ext" '' "RouteStudio.AssociationTest.Second.$ext"
    }
    Write-Host 'Verifying upgrade preserves the later default-app choices.'
    Run-Installer
    Assert-Handlers
    Assert-Defaults 'RouteStudio.AssociationTest.Second'

    Write-Host 'Verifying uninstall removes only application-owned handlers.'
    $uninstaller = Join-Path $installDir 'Uninstall Route Studio.exe'
    $process = Start-Process -FilePath $uninstaller -ArgumentList "/S _?=$installDir" -PassThru -Wait
    Assert-Equal $process.ExitCode 0 'Uninstall failed'
    Assert-Defaults 'RouteStudio.AssociationTest.Second'
    foreach ($ext in $extensions) {
        Assert-Equal (Test-Path "$classes\RouteStudio.$ext") $false 'ProgID left after uninstall'
        Assert-Equal (Test-Path "$classes\SystemFileAssociations\.$ext\shell\RouteStudio.Open") $false 'Context menu left after uninstall'
        Assert-Equal (Read-Value "$classes\.$ext\OpenWithProgids" "RouteStudio.$ext") $null 'Open With candidate left after uninstall'
    }
    Write-Host 'Installed, upgraded and removed all four handlers without changing default-app choices.'
} finally {
    foreach ($ext in $backup.Keys) {
        if ($backup[$ext].present) {
            Set-ClassValue ".$ext" '' $backup[$ext].value $backup[$ext].kind
        } else {
            Remove-ClassValue ".$ext" ''
        }
        Remove-ClassValue ".$ext\OpenWithProgids" 'RouteStudio.AssociationTest.Other'
    }
}
