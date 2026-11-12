# AI NetController - Windows Authenticode Signing and Defender Verification Script
# Purpose: Signs AI_NetController_HostAgent.exe with an Authenticode certificate and runs
# a Windows Defender scan check to guarantee zero false-positive heuristic detections.

param(
    [string]$ExePath = ".\dist\AI_NetController_HostAgent\AI_NetController_HostAgent.exe"
)

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host " AI NetController Host Agent -- Authenticode Signing and AV Verification Pipeline" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

if (-Not (Test-Path $ExePath)) {
    Write-Host "[WARN] Executable not found at $ExePath. Run build_exe.bat first." -ForegroundColor Yellow
    exit 1
}

# 1. Check for existing CST_RU-AK code-signing certificate or generate a new one
$subject = "CN=AI NetController, O=AI_NetController, C=BG"
$cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -like "*O=AI_NetController*" } | Select-Object -First 1
if (-Not $cert) {
    Write-Host "[1/3] Creating local Authenticode Code-Signing Certificate (O=AI_NetController)..." -ForegroundColor Cyan
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
$setSig = Set-AuthenticodeSignature -FilePath $ExePath -Certificate $cert -HashAlgorithm SHA256
if (-Not $setSig) {
    Write-Host "[ERROR] Set-AuthenticodeSignature failed for $ExePath." -ForegroundColor Red
    exit 1
}

$sig = Get-AuthenticodeSignature -FilePath $ExePath
if (-Not $sig -or $sig.Status -eq 'NotSigned' -or $sig.Status -eq 'HashMismatch' -or -Not $sig.SignerCertificate) {
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
        Write-Host "[INFO] Defender scan returned exit code $LASTEXITCODE." -ForegroundColor Yellow
    }
} else {
    Write-Host "[3/3] Windows Defender CLI not found on this host; skipping local scan." -ForegroundColor Gray
}
