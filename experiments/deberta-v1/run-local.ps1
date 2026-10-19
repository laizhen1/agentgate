param(
    [string]$Python = 'python',
    [string]$Output = 'runs/run-001'
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function CheckedPython {
    param([string[]]$Arguments)
    & $Python @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Python command failed: $Arguments" }
}
CheckedPython -Arguments @('-m', 'pip', 'install', 'torch==2.8.0', '--index-url', 'https://download.pytorch.org/whl/cu128')
CheckedPython -Arguments @('-m', 'pip', 'install', '-r', 'requirements.txt')
CheckedPython -Arguments @('fetch_sources.py')
if (-not (Test-Path 'data/manifest.json')) { CheckedPython -Arguments @('prepare_data.py') }
CheckedPython -Arguments @('-B', '-m', 'unittest', 'test_protocol.py')
CheckedPython -Arguments @('-u', 'run_experiment.py', '--output', $Output)
CheckedPython -Arguments @('summarize.py', $Output)
CheckedPython -Arguments @('verify_artifacts.py', $Output)
