# AI NetController - Signed Windows MSIX Packager
# Packages the clean --onedir build (dist\AI_NetController_HostAgent) into a signed .msix
# for native Windows 11 App Installer & Smart App Control trust alignment.

param(
    [string]$DistDir = ".\dist\AI_NetController_HostAgent",
    [string]$OutputMsix = ".\dist\AI_NetController_HostAgent_0.60.0_x64.msix",
    [string]$Publisher = "",
    [string]$Thumbprint = $env:AI_CODESIGN_THUMBPRINT,
    [string]$TimestampUrl = "http://timestamp.digicert.com",
    [switch]$AllowSelfSigned
)

$ErrorActionPreference = "Stop"

if (-Not (Test-Path $DistDir)) {
    Write-Host "[ERROR] --onedir build folder not found at $DistDir. Run build_exe.bat first." -ForegroundColor Red
    exit 1
}

$makeAppx = Get-Command makeappx.exe -ErrorAction SilentlyContinue
if (-Not $makeAppx) {
    $sdkRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    if (Test-Path $sdkRoot) {
        $found = Get-ChildItem -Path $sdkRoot -Filter "makeappx.exe" -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -like "*\x64\*" } |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($found) { $makeAppx = $found }
    }
}

if (-Not $makeAppx) {
    Write-Host "[ERROR] Windows SDK 'makeappx.exe' not found. Install Windows 10/11 SDK to build MSIX packages." -ForegroundColor Red
    exit 1
}

$staging = Join-Path $env:TEMP ("ainet_msix_stage_" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $staging -Force | Out-Null

try {
    $appSub = Join-Path $staging "AI_NetController_HostAgent"
    Copy-Item -Path $DistDir -Destination $appSub -Recurse -Force
    $assetsSub = Join-Path $staging "assets"
    New-Item -ItemType Directory -Path $assetsSub -Force | Out-Null
    Copy-Item -Path ".\assets\*" -Destination $assetsSub -Force

    $manifestDst = Join-Path $staging "AppxManifest.xml"
    $manifestXml = Get-Content -Path ".\AppxManifest.xml" -Raw -Encoding UTF8
    if ($Publisher) {
        $manifestXml = $manifestXml -replace 'Publisher="[^"]+"', "Publisher=`"$Publisher`""
    }
    Set-Content -Path $manifestDst -Value $manifestXml -Encoding UTF8

    if (Test-Path $OutputMsix) { Remove-Item $OutputMsix -Force }
    & $makeAppx.Source pack /d $staging /p $OutputMsix /o
    if ($LASTEXITCODE -ne 0) {
        throw "makeappx.exe failed with exit code $LASTEXITCODE"
    }

    $signArgs = @("-ExecutionPolicy", "Bypass", "-File", ".\sign_binary.ps1", "-TargetPath", $OutputMsix, "-TimestampUrl", $TimestampUrl)
    if ($Thumbprint) { $signArgs += @("-Thumbprint", $Thumbprint) }
    if ($AllowSelfSigned) { $signArgs += "-AllowSelfSigned" }

    & powershell @signArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Authenticode signing failed for $OutputMsix"
    }

    Write-Host "[PASS] Signed MSIX package ready: $OutputMsix" -ForegroundColor Green
} finally {
    if (Test-Path $staging) {
        Remove-Item -Path $staging -Recurse -Force -ErrorAction SilentlyContinue
    }
}
