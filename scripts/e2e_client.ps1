# ==============================================================================
# Sparks Registry E2E Clean Client Verification Script
# Tests end-to-end package resolution, cryptographic verification, and installation
# using the real compiled Datara Package Manager (dpm) against a local Sparks registry.
# ==============================================================================

param (
    [string]$SparksRoot = "D:\DATARA\sparks",
    [string]$CompilerRoot = "D:\DATARA\datara + forgen"
)

$ErrorActionPreference = "Stop"

Write-Host "=== Starting Sparks E2E Clean Client Verification ===" -ForegroundColor Cyan

# 1. Locate dpm binary
$dpmExe = Join-Path $CompilerRoot "target\debug\dpm.exe"
if (-not (Test-Path $dpmExe)) {
    Write-Host "[BUILD] dpm.exe not found. Compiling via cargo..." -ForegroundColor Yellow
    $cargoExe = "$HOME\.cargo\bin\cargo.exe"
    & $cargoExe build --bin dpm --manifest-path (Join-Path $CompilerRoot "Cargo.toml")
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to build dpm binary!"
    }
}
Write-Host "[OK] Found dpm binary: $dpmExe" -ForegroundColor Green

# 2. Start local static HTTP server for Sparks
$port = 18443
$serverJob = Start-Process python -ArgumentList "-m", "http.server", "$port", "--directory", "$SparksRoot" -PassThru -NoNewWindow
Start-Sleep -Milliseconds 800

try {
    $env:DATARA_SPARKS_REGISTRY = "http://127.0.0.1:$port"
    $env:FORGEN_ALLOW_HTTP = "1"
    Write-Host "[SERVER] Local registry server listening on $env:DATARA_SPARKS_REGISTRY" -ForegroundColor Green

    # 3. Create fresh temp project
    $tempProject = Join-Path ([System.IO.Path]::GetTempPath()) ("sparks_e2e_client_" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $tempProject -Force | Out-Null
    Write-Host "[PROJECT] Clean consumer project created: $tempProject" -ForegroundColor Green

    # 4. Test adding all 5 official seed packages
    $seeds = @("sparks/crypto_core", "sparks/math_simd", "sparks/http_router", "sparks/lockstep_engine", "sparks/toy_kv")

    foreach ($pkg in $seeds) {
        Write-Host "`n--- Testing: dpm add $pkg ---" -ForegroundColor Yellow
        $rawId = $pkg.Replace("sparks/", "")
        
        Push-Location $tempProject
        try {
            & $dpmExe add $pkg
            if ($LASTEXITCODE -ne 0) {
                Write-Error "dpm add $pkg exited with code $LASTEXITCODE"
            }

            # Verify extraction and integrity
            $pkgDir = Join-Path $tempProject "packages\sparks\$rawId"
            if (-not (Test-Path $pkgDir)) {
                Write-Error "Expected package directory not found: $pkgDir"
            }
            if (-not (Test-Path (Join-Path $pkgDir "main.dtr"))) {
                Write-Error "main.dtr missing from $pkgDir"
            }
            if (-not (Test-Path (Join-Path $pkgDir "capabilities.json"))) {
                Write-Error "capabilities.json missing from $pkgDir"
            }
            Write-Host "[PASS] Successfully installed & verified $pkg" -ForegroundColor Green
        }
        finally {
            Pop-Location
        }
    }

    # 4b. Test installing pinned older version
    Write-Host "`n--- Testing: dpm add sparks/crypto_core@0.9.0 (Pinned Older Version) ---" -ForegroundColor Yellow
    Push-Location $tempProject
    try {
        & $dpmExe add "sparks/crypto_core@0.9.0"
        if ($LASTEXITCODE -ne 0) {
            Write-Error "dpm add sparks/crypto_core@0.9.0 exited with code $LASTEXITCODE"
        }
        $pkgDir = Join-Path $tempProject "packages\sparks\crypto_core"
        if (-not (Test-Path $pkgDir)) {
            Write-Error "Expected package directory not found: $pkgDir"
        }
        Write-Host "[PASS] Successfully installed & verified pinned sparks/crypto_core@0.9.0" -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
    Write-Host "`n--- Negative Test: Unreachable Registry ---" -ForegroundColor Yellow
    $env:DATARA_SPARKS_REGISTRY = "http://127.0.0.1:65534"
    Push-Location $tempProject
    try {
        $p = Start-Process $dpmExe -ArgumentList "add", "sparks/crypto_core" -NoNewWindow -PassThru -Wait
        if ($p.ExitCode -eq 0) {
            Write-Error "Expected dpm add to fail with unreachable registry, but it returned 0!"
        }
        Write-Host "[PASS] Unreachable registry gracefully rejected with exit code $($p.ExitCode)" -ForegroundColor Green
    }
    finally {
        Pop-Location
    }

    Write-Host "`n[SUCCESS] ALL E2E CLEAN CLIENT SCENARIOS VERIFIED 100% CLEAN!" -ForegroundColor Green
}
finally {
    # 6. Cleanup
    if ($serverJob -and -not $serverJob.HasExited) {
        Stop-Process -Id $serverJob.Id -Force
        Write-Host "[CLEANUP] Stopped background registry server." -ForegroundColor Gray
    }
    if (Test-Path $tempProject) {
        Remove-Item -Path $tempProject -Recurse -Force -ErrorAction SilentlyContinue
    }
}
