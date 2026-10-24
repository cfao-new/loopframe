param(
  [string]$Version = "",
  [string]$AppDirectory = "",
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Version) {
  $Version = (Get-Content (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json).version
}
if (-not $AppDirectory) {
  $AppDirectory = Join-Path $projectRoot "dist\win-unpacked"
}
if (-not $OutputPath) {
  $OutputPath = Join-Path $projectRoot "dist\Loopframe-$Version-x64.exe"
}

$AppDirectory = (Resolve-Path -LiteralPath $AppDirectory).Path
$applicationExe = Join-Path $AppDirectory "Loopframe.exe"
if (-not (Test-Path -LiteralPath $applicationExe)) {
  throw "The unpacked Windows application was not found."
}

$resourceZip = Join-Path $env:TEMP ("loopframe-launcher-" + [guid]::NewGuid().ToString("N") + ".zip")
$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$source = Join-Path $PSScriptRoot "WindowsLauncher.cs"
$generatedSource = Join-Path $env:TEMP ("loopframe-launcher-" + [guid]::NewGuid().ToString("N") + ".cs")
$icon = @(
  (Join-Path $projectRoot "dist-release\.icon-ico\icon.ico"),
  (Join-Path $projectRoot "dist\.icon-ico\icon.ico")
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$compressionAssembly = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\System.IO.Compression.FileSystem.dll"
$compressionCoreAssembly = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\System.IO.Compression.dll"

try {
  $assemblyVersion = "$Version.0"
  $sourceText = Get-Content -LiteralPath $source -Raw
  $sourceText = $sourceText.Replace("__VERSION__", $Version).Replace("__ASSEMBLY_VERSION__", $assemblyVersion)
  Set-Content -LiteralPath $generatedSource -Value $sourceText -Encoding utf8
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $AppDirectory,
    $resourceZip,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
  )

  $compilerArguments = @(
    "/nologo",
    "/target:winexe",
    "/platform:x64",
    "/optimize+",
    "/out:$OutputPath",
    "/resource:$resourceZip,Loopframe.App.zip",
    "/reference:$compressionAssembly",
    "/reference:$compressionCoreAssembly",
    "/reference:System.Windows.Forms.dll",
    $generatedSource
  )
  if ($icon) {
    $compilerArguments = @("/win32icon:$icon") + $compilerArguments
  }

  & $compiler @compilerArguments
  if ($LASTEXITCODE -ne 0) {
    throw "The Windows launcher did not compile."
  }
  Get-Item -LiteralPath $OutputPath
}
finally {
  if (Test-Path -LiteralPath $resourceZip) {
    Remove-Item -LiteralPath $resourceZip -Force
  }
  if (Test-Path -LiteralPath $generatedSource) {
    Remove-Item -LiteralPath $generatedSource -Force
  }
}
