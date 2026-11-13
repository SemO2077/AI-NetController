# AI NetController - Windows Authenticode Signing and Defender Verification Script
# Purpose: Signs AI_NetController_HostAgent.exe with an Authenticode certificate and runs
# a Windows Defender scan check to guarantee zero false-positive heuristic detections.

param(
    [string]$ExePath = ".\dist\AI_NetController_HostAgent\AI_NetController_HostAgent.exe",
    [string]$Thumbprint = $env:AI_CODESIGN_THUMBPRINT,
    [string]$TimestampUrl = "",
    [switch]$AllowSelfSigned
)

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host " AI NetController Host Agent -- Authenticode Signing and AV Verification Pipeline" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

if (-Not (Test-Path $ExePath)) {
    Write-Host "[WARN] Executable not found at $ExePath. Run build_exe.bat first." -ForegroundColor Yellow
    exit 1
}

# 1. Locate an explicit / existing code-signing certificate; only mint self-signed when explicitly requested
$cert = $null
if ($Thumbprint) {
    $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Thumbprint -eq $Thumbprint } | Select-Object -First 1
} else {
    $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -like "*O=AI_NetController*" } | Select-Object -First 1
}

if (-Not $cert) {
    if (-Not $AllowSelfSigned) {
        Write-Host "[ERROR] No Authenticode code-signing certificate found. Set AI_CODESIGN_THUMBPRINT / -Thumbprint or pass -AllowSelfSigned for local dev testing." -ForegroundColor Red
        exit 1
    }
    $subject = "CN=AI NetController, O=AI_NetController, C=BG"
    Write-Host "[1/3] Creating local dev Self-Signed Authenticode Certificate (-AllowSelfSigned)..." -ForegroundColor Yellow
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $subject `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -HashAlgorithm SHA256 `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -NotAfter (Get-Date).AddYears(3)
}

# 2. Apply Authenticode SHA-256 Digital Signature
Write-Host "[2/3] Applying SHA-256 Authenticode Signature to $ExePath..." -ForegroundColor Cyan
if ($TimestampUrl) {
    $setSig = Set-AuthenticodeSignature -FilePath $ExePath -Certificate $cert -HashAlgorithm SHA256 -TimestampServer $TimestampUrl
} else {
    $setSig = Set-AuthenticodeSignature -FilePath $ExePath -Certificate $cert -HashAlgorithm SHA256
}
if (-Not $setSig) {
    Write-Host "[ERROR] Set-AuthenticodeSignature failed for $ExePath." -ForegroundColor Red
    exit 1
}

$sig = Get-AuthenticodeSignature -FilePath $ExePath
if (-Not $sig -or $sig.Status -eq 'NotSigned' -or $sig.Status -eq 'HashMismatch' -or -Not $sig.SignerCertificate -or ((-Not $AllowSelfSigned) -and $sig.Status -ne 'Valid')) {
    Write-Host "[ERROR] Authenticode verification failed (Status: $($sig.Status)) for $ExePath." -ForegroundColor Red
    exit 1
}
Write-Host "      Signature Status     : $($sig.Status)" -ForegroundColor Green
Write-Host "      Signature Certificate: $($sig.SignerCertificate.Subject)" -ForegroundColor Green
Write-Host "      Signature Thumbprint : $($sig.SignerCertificate.Thumbprint)" -ForegroundColor Green

# 3. Verify with Windows Defender CLI Scanner (if present)
$defenderCli = "$env:ProgramFiles\Windows Defender\MpCmdRun.exe"
if (Test-Path $defenderCli) {
    Write-Host "[3/3] Running Windows Defender Heuristic and Signature Scan..." -ForegroundColor Cyan
    $resolvedPath = (Resolve-Path $ExePath).Path
    & $defenderCli -Scan -ScanType 3 -File $resolvedPath
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[PASS] Windows Defender verified ${resolvedPath}: CLEAN (0 threats found)." -ForegroundColor Green
    } else {
        Write-Host "[ERROR] Defender scan failed with exit code $LASTEXITCODE." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "[3/3] Windows Defender CLI not found on this host; skipping local scan." -ForegroundColor Gray
}
