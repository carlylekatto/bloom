<#
.SYNOPSIS
	Runs a command with the MSVC toolchain loaded.

.DESCRIPTION
	Every cargo command on this machine needs the MSVC linker, and nothing puts
	it on PATH. The toolset lives in a versioned folder --
	VC\Tools\MSVC\<version>\bin\Hostx64\x64\link.exe -- and VS replaces that
	folder on every update, so a permanent PATH entry goes stale. Worse, PATH
	is not enough on its own: the msvc target links msvcrt.lib, which only
	resolves through the LIB variable. vcvars64.bat sets PATH, INCLUDE and LIB
	together, for one shell.

	MSBuild and CMake find the toolset through the registry. rustc does not: it
	does one PATH lookup for link.exe and nothing else. That is why `cargo
	build` fails with "linker `link.exe` not found" on a machine where VS is
	installed and working.

	So this resolves the toolset, imports vcvars64's environment into the
	current process, and runs the command. Nothing is pinned to a version, so a
	VS update needs no edit here.

	The alternative is the "Developer PowerShell for VS Insiders" shortcut in
	the Start Menu, which does the same thing. This script is for when that is
	not the shell you happen to be in.

.PARAMETER Dir
	Working directory for the command. Defaults to the repository root. Every
	cargo command here lives in src-tauri, so those need
	`-Dir src-tauri`.

.PARAMETER Command
	The command and its arguments. Defaults to `cargo check --locked`.

.EXAMPLE
	.\scripts\vc-env.ps1 cargo check --locked

.EXAMPLE
	.\scripts\vc-env.ps1 -Dir src-tauri cargo test --locked

.EXAMPLE
	.\scripts\vc-env.ps1 bun run tauri build
#>
param(
	# Order and Position both matter, and getting either wrong is silent.
	# $Command must come first so it takes positional slot 0, and it needs an
	# explicit Position for that -- without it PowerShell hands the first bare
	# token to whichever parameter it saw first, so `vc-env.ps1 cargo test`
	# ends up with -Dir set to "cargo" and dies looking for a directory named
	# cargo. Tested: this ordering binds `-Dir src-tauri cargo test` and
	# `cmd /c exit 3` correctly.
	[Parameter(Position = 0, ValueFromRemainingArguments = $true)]
	[string[]]$Command = @("cargo", "check", "--locked"),

	[string]$Dir
)

$ErrorActionPreference = "Stop"

function Resolve-Vcvars {
	# Preferred path: ask the installer. `-all -prerelease` matters -- without
	# the prerelease flag this reports nothing for a VS 2026 Insiders install,
	# which reads as "no toolchain installed" and sends you looking elsewhere.
	$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
	if (Test-Path $vswhere) {
		$roots = & $vswhere -all -prerelease -products * `
			-requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
			-property installationPath
		foreach ($root in $roots) {
			if (-not $root) { continue }
			$vcvars = Join-Path $root "VC\Auxiliary\Build\vcvars64.bat"
			if (Test-Path $vcvars) { return $vcvars }
		}
	}

	# Fallback for when the installer cannot answer. Newest toolset version
	# wins, sorted numerically rather than alphabetically so 9.x beats 10.x.
	$toolsetRoot = Join-Path ${env:ProgramFiles} "Microsoft Visual Studio"
	if (Test-Path $toolsetRoot) {
		$vcvars = Get-ChildItem $toolsetRoot -Recurse -Filter "vcvars64.bat" -ErrorAction SilentlyContinue |
			Sort-Object { $_.Directory.Parent.Parent.Name } -Descending |
			Select-Object -First 1
		if ($vcvars) { return $vcvars.FullName }
	}

	return $null
}

$vcvars = Resolve-Vcvars
if (-not $vcvars) {
	throw @"
No MSVC toolchain found. Install Visual Studio Build Tools with the
Desktop development with C++ workload:

  winget install Microsoft.VisualStudio.2022.BuildTools --override `"--quiet --wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended`"

Or use the Developer PowerShell for VS Insiders shortcut, which already has
this environment.
"@
}

# `call vcvars && set` makes cmd print the resulting environment; vcvars sets
# variables we need in this process, not in a child we are about to exit.
cmd /c "call `"$vcvars`" >nul 2>&1 && set" | ForEach-Object {
	$split = $_.IndexOf("=")
	if ($split -gt 0) {
		[Environment]::SetEnvironmentVariable(
			$_.Substring(0, $split),
			$_.Substring($split + 1),
			"Process"
		)
	}
}

if (-not $env:LIB) {
	throw "vcvars64 ran but set no LIB. The MSVC toolset at `"$vcvars`" looks incomplete."
}

if (-not $Dir) {
	$Dir = Split-Path -Parent $PSScriptRoot
}
if (-not (Test-Path $Dir)) {
	throw "No such directory: $Dir"
}

Push-Location $Dir
try {
	& $Command[0] @($Command | Select-Object -Skip 1)
	exit $LASTEXITCODE
}
finally {
	Pop-Location
}