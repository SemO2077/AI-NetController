# AI NetController - Windows Authenticode Signing & Defender Verification Script
# Signs every PE binary (.exe, .dll, .pyd) in the build output directory or a single target file
# with SHA-256 Authenticode + optional RFC 3161 timestamping and scans with Windows Defender.

param(
    [Alias("ExePath")]
    [string]$TargetPath = ".\dist\AI_NetController_HostAgent",
    [string]$Thumbprint = $env:AI_CODESIGN_THUMBPRINT,
    [string]$TimestampUrl = "http://timestamp.digicert.com",
    [switch]$SkipTimestamp,
    [switch]$AllowSelfSigned
)

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host " AI NetController Host Agent -- Authenticode Signing & AV Pipeline" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

if (-Not (Test-Path $TargetPath)) {
    Write-Host "[WARN] Target path not found: $TargetPath. Run build_exe.bat first." -ForegroundColor Yellow
    exit 1
}

# 1. Locate trusted Code Signing cert (or create local self-signed dev cert when -AllowSelfSigned)
$cert = $null
if ($Thumbprint) {
    $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Thumbprint -eq $Thumbprint } | Select-Object -First 1
} else {
    $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -like "*O=AI_NetController*" } | Select-Object -First 1
}

if (-Not $cert) {
    if (-Not $AllowSelfSigned) {
        Write-Host "[ERROR] No Authenticode code-signing certificate found." -ForegroundColor Red
        Write-Host "        Set AI_CODESIGN_THUMBPRINT / -Thumbprint for production signing (required for Windows Smart App Control)," -ForegroundColor Red
        Write-Host "        or pass -AllowSelfSigned for local developer verification only." -ForegroundColor Red
        exit 1
    }
    Write-Host "[WARN] -AllowSelfSigned active: Smart App Control (UMCI) still requires a publicly trusted CA / Azure Trusted Signing cert for end-user PCs." -ForegroundColor Yellow
    $subject = "CN=AI NetController Dev, O=AI_NetController, C=BG"
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $subject `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -HashAlgorithm SHA256 `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -NotAfter (Get-Date).AddYears(3)
}

# 2. Gather every PE binary (.exe, .dll, .pyd, .msix) under TargetPath
$item = Get-Item $TargetPath
if ($item.PSIsContainer) {
    $filesToSign = Get-ChildItem -Path $item.FullName -Recurse -File | Where-Object {
        $_.Extension -in @(".exe", ".dll", ".pyd", ".msix")
    }
} else {
    $filesToSign = @($item)
}

if (-Not $filesToSign -or $filesToSign.Count -eq 0) {
    Write-Host "[ERROR] No signable binaries (.exe, .dll, .pyd) discovered in $TargetPath." -ForegroundColor Red
    exit 1
}

Write-Host "[1/3] Signing $($filesToSign.Count) PE binary artifact(s) with SHA-256 Authenticode..." -ForegroundColor Cyan
$signedCount = 0
foreach ($file in $filesToSign) {
    $sigResult = $null
    if (-Not $SkipTimestamp -and $TimestampUrl) {
        try {
            $sigResult = Set-AuthenticodeSignature -FilePath $file.FullName -Certificate $cert -HashAlgorithm SHA256 -TimestampServer $TimestampUrl
        } catch {
            $sigResult = $null
        }
    }
    if (-Not $sigResult -or $sigResult.Status -eq "UnknownError") {
        $sigResult = Set-AuthenticodeSignature -FilePath $file.FullName -Certificate $cert -HashAlgorithm SHA256
    }

    $verify = Get-AuthenticodeSignature -FilePath $file.FullName
    if (-Not $verify -or $verify.Status -eq "NotSigned" -or $verify.Status -eq "HashMismatch" -or -Not $verify.SignerCertificate -or ((-Not $AllowSelfSigned) -and $verify.Status -ne "Valid")) {
        Write-Host "[ERROR] Authenticode verification failed ($($verify.Status)) for $($file.Name)" -ForegroundColor Red
        exit 1
    }
    $signedCount++
}

Write-Host "[2/3] Signed & verified $signedCount/$($filesToSign.Count) binary files cleanly." -ForegroundColor Green
Write-Host "      Certificate Subject   : $($cert.Subject)" -ForegroundColor Green
Write-Host "      Certificate Thumbprint: $($cert.Thumbprint)" -ForegroundColor Green

# 3. Verify with Windows Defender CLI Scanner (if present)
$defenderCli = "$env:ProgramFiles\Windows Defender\MpCmdRun.exe"
if (Test-Path $defenderCli) {
    Write-Host "[3/3] Running Windows Defender Heuristic & Signature Scan on $($item.FullName)..." -ForegroundColor Cyan
    & $defenderCli -Scan -ScanType 3 -File $item.FullName
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[PASS] Windows Defender verified $($item.FullName): CLEAN (0 threats)." -ForegroundColor Green
    } else {
        Write-Host "[ERROR] Defender scan exited with code $LASTEXITCODE." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "[3/3] Windows Defender CLI not found on this host; skipping local scan." -ForegroundColor Gray
}
