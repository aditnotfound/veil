<#
.SYNOPSIS
Passively timestamp answer text exposed by an already-running packaged Veil window.
.EXAMPLE
pwsh scripts/observe_packaged_listen.ps1 -ProcessId 1234 -OutputPath "$env:TEMP\veil-visible.jsonl" -DurationSeconds 180

The output contains timestamps and SHA-256 prompt fingerprints, never call text or
answer text. Keep Listen expanded while measuring. UI Automation can read text in
a window even when another window covers it, so confirm actual on-screen visibility
with the user or a separate screen check.
#>
param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [ValidateRange(5, 3600)][int]$DurationSeconds = 180,
  [ValidateRange(50, 1000)][int]$PollMilliseconds = 100
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$process = Get-Process -Id $ProcessId -ErrorAction Stop
if ($process.ProcessName -ne 'pluely' -or $process.MainWindowHandle -eq [IntPtr]::Zero) {
  throw 'The supplied process is not a visible packaged Veil window.'
}
$window = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
$documentCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Document
)
$outputFile = [System.IO.Path]::GetFullPath($OutputPath)
$parent = [System.IO.Path]::GetDirectoryName($outputFile)
if (-not [System.IO.Directory]::Exists($parent)) {
  throw "Output directory does not exist: $parent"
}
if ([System.IO.File]::Exists($outputFile)) {
  throw "Output already exists: $outputFile"
}
[System.IO.File]::WriteAllText($outputFile, '')

function Write-Event([string]$eventName, [string]$promptHash, [long]$at) {
  $event = [ordered]@{
    event = $eventName
    at = $at
    promptHash = $promptHash
  }
  [System.IO.File]::AppendAllText($outputFile,
    (($event | ConvertTo-Json -Compress) + [Environment]::NewLine))
}

function Hash-Prompt([string]$prompt) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($prompt.Trim())
  $hash = [System.Security.Cryptography.SHA256]::HashData($bytes)
  return [Convert]::ToHexString($hash).ToLowerInvariant()
}

$currentHash = ''
$waitingForText = $false
$completed = $false
$deadline = [Environment]::TickCount64 + ($DurationSeconds * 1000)
$observed = 0

while ([Environment]::TickCount64 -lt $deadline) {
  if ($process.HasExited) { break }
  try {
    $document = $window.FindFirst(
      [System.Windows.Automation.TreeScope]::Descendants, $documentCondition
    )
    if ($null -eq $document -or $window.Current.IsOffscreen) {
      Start-Sleep -Milliseconds $PollMilliseconds
      continue
    }
    $display = $document.GetCurrentPattern(
      [System.Windows.Automation.TextPattern]::Pattern
    ).DocumentRange.GetText(20000)
    $matches = [regex]::Matches(
      $display,
      '(?is)Answering\s*[·:]\s*(?<prompt>[^\r\n]+)\s+Initial\s*[·:]\s*unverified\s*(?<answer>.*?)(?:\r?\nGo deeper|$)'
    )
    if ($matches.Count -eq 0) {
      $currentHash = ''
      $waitingForText = $false
      $completed = $false
      Start-Sleep -Milliseconds $PollMilliseconds
      continue
    }
    $active = $matches[$matches.Count - 1]
    $promptHash = Hash-Prompt $active.Groups['prompt'].Value
    $answer = $active.Groups['answer'].Value.Trim()
    # TextPattern may append later controls after the spinner; inspect its prefix.
    $generating = $answer -match '^(?:Generating(?: response)?|Thinking)(?:[.\u2026]|\s|$)'
    if ($promptHash -ne $currentHash) {
      $currentHash = $promptHash
      $waitingForText = $true
      $completed = $false
      Write-Event 'answer_prompt' $promptHash ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    } elseif ($generating -and -not $waitingForText) {
      # Answer now can regenerate the same prompt without changing its hash.
      $waitingForText = $true
      $completed = $false
      Write-Event 'answer_prompt' $promptHash ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    }
    if ($waitingForText -and $answer.Length -ge 8 -and -not $generating) {
      Write-Event 'first_answer_text' $promptHash ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
      $waitingForText = $false
      $observed++
    }
    if (-not $waitingForText -and -not $completed -and $display -match '\bGo deeper\b') {
      Write-Event 'answer_complete_ui' $promptHash ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
      $completed = $true
    }
  } catch [System.Windows.Automation.ElementNotAvailableException] {
    # The WebView replaced its automation tree during a render; retry next poll.
  } catch [System.InvalidOperationException] {
    # A transient UI Automation read can fail while the WebView is resizing.
  }
  Start-Sleep -Milliseconds $PollMilliseconds
}

[pscustomobject]@{
  OutputPath = $outputFile
  FirstAnswerEvents = $observed
  ProcessExited = $process.HasExited
}
