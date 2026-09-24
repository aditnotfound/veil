<#
.SYNOPSIS
Run one spoken synthetic question through an already-running packaged Veil app.
.EXAMPLE
pwsh scripts/test_packaged_listen.ps1 -ProcessId 1234 -Question 'What is nine plus twelve?' -TranscriptPattern 'What is (9|nine) plus (12|twelve)' -AnswerPattern '21'

The transcript and answer arguments are regular expressions. AnswerPattern is
matched anywhere in the active answer card, so a correct explanatory answer
may contain the expected value alongside other text.
#>
param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [string]$Question = 'What is nine plus twelve?',
  [string]$TranscriptPattern = 'What is (9|nine) plus (12|twelve)',
  [string]$AnswerPattern = '21',
  [ValidateRange(5, 90)][int]$TimeoutSeconds = 30,
  [switch]$Trace
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Get-Window {
  $process = Get-Process -Id $ProcessId -ErrorAction Stop
  if ($process.ProcessName -ne 'pluely' -or $process.MainWindowHandle -eq [IntPtr]::Zero) {
    throw 'The supplied process is not a visible packaged Veil window.'
  }
  return [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
}

function Get-Elements($window) {
  return $window.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )
}

function Find-Button($window, [string]$name) {
  foreach ($element in (Get-Elements $window)) {
    if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
        $element.Current.Name -eq $name) {
      return $element
    }
  }
  return $null
}

function Invoke-Button($window, [string]$name) {
  $button = Find-Button $window $name
  if ($null -eq $button) { throw "Button missing: $name" }
  $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
}

function Find-CaptureButton($window) {
  foreach ($element in (Get-Elements $window)) {
    if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
        ($element.GetSupportedPatterns().ProgrammaticName -contains
          'ExpandCollapsePatternIdentifiers.Pattern')) {
      return $element
    }
  }
  return $null
}

function Get-CaptureButton($window, [int]$TimeoutMs = 15000) {
  $deadline = [Environment]::TickCount64 + $TimeoutMs
  do {
    $button = Find-CaptureButton $window
    if ($null -ne $button) { return $button }
    Start-Sleep -Milliseconds 250
  } while ([Environment]::TickCount64 -lt $deadline)
  throw 'Listen capture control was not found.'
}

function Get-DocumentText($window) {
  foreach ($element in (Get-Elements $window)) {
    if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Document) {
      return $element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern).
        DocumentRange.GetText(10000)
    }
  }
  return ''
}

function Get-AnswerPrompt($display) {
  $matches = [regex]::Matches($display, '(?m)Answering\s*[·:]\s*(?<prompt>[^\r\n]+)')
  if ($matches.Count -eq 0) { return '' }
  return $matches[$matches.Count - 1].Groups['prompt'].Value.Trim()
}

function Get-VisibleAnswerText($display) {
  # Restrict matching to the active card. Searching the whole document can
  # mistake a previous answer or transcript text for the new answer.
  $matches = [regex]::Matches(
    $display,
    '(?is)Answering\s*[·:]\s*[^\r\n]+\s+Initial\s*[·:]\s*unverified\s*(?<answer>.*?)(?:\r?\nGo deeper|$)'
  )
  if ($matches.Count -eq 0) { return '' }
  return $matches[$matches.Count - 1].Groups['answer'].Value.Trim()
}

function Now-Milliseconds {
  return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}

$window = Get-Window
$capture = Get-CaptureButton $window
$opened = $false
$wasManual = $false
$wasMicOn = $false
$result = [ordered]@{
  Question = $Question
  TranscriptDetected = $false
  AnswerStarted = $false
  AnswerVisible = $false
  TranscriptVisibleMs = $null
  FirstAnswerVisibleMs = $null
  TotalAnswerMs = $null
  ProviderError = $null
}

try {
  $state = $capture.GetCurrentPattern(
    [System.Windows.Automation.ExpandCollapsePattern]::Pattern
  ).Current.ExpandCollapseState
  if ($state -ne [System.Windows.Automation.ExpandCollapseState]::Collapsed) {
    throw 'Start this test with Listen capture stopped, so the result belongs to one fresh session.'
  }
  $capture.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand()
  $opened = $true
  Start-Sleep -Seconds 2

  $wasManual = $null -ne (Find-Button $window 'Start Recording')
  $wasMicOn = $null -ne (Find-Button $window 'Mic On')
  if ($wasManual) {
    Invoke-Button $window 'Auto-detect (voice activity)'
    Start-Sleep -Seconds 2
    if ($null -ne (Find-Button $window 'Start Recording')) {
      throw 'Auto-detect did not become active.'
    }
  }
  if ($wasMicOn) { Invoke-Button $window 'Mic On' }

  $voice = New-Object -ComObject SAPI.SpVoice
  $voice.Rate = 1
  $baselineAnswerPrompt = Get-AnswerPrompt (Get-DocumentText $window)
  $null = $voice.Speak($Question)
  $speechEndedAt = Now-Milliseconds
  $deadline = $speechEndedAt + $TimeoutSeconds * 1000

  while ((Now-Milliseconds) -lt $deadline) {
    $display = Get-DocumentText $window
    $now = Now-Milliseconds
    if (-not $result.TranscriptDetected -and $display -match $TranscriptPattern) {
      $result.TranscriptDetected = $true
      $result.TranscriptVisibleMs = $now - $speechEndedAt
    }
    $answerPrompt = Get-AnswerPrompt $display
    if (-not $result.AnswerStarted -and $result.TranscriptDetected -and
        $answerPrompt -and $answerPrompt -ne $baselineAnswerPrompt) {
      $result.AnswerStarted = $true
    }
    $visibleAnswer = Get-VisibleAnswerText $display
    if ($Trace -and ($display -match 'Answering\s*[·:]' -or $result.AnswerStarted)) {
      Write-Host ("TRACE prompt=[{0}] answer=[{1}]" -f $answerPrompt, $visibleAnswer)
    }
    if ($result.AnswerStarted -and -not $result.AnswerVisible -and
        $visibleAnswer -match $AnswerPattern) {
      $result.AnswerVisible = $true
      $result.FirstAnswerVisibleMs = $now - $speechEndedAt
    }
    if ($result.AnswerVisible -and $display -match 'Go deeper') {
      $result.TotalAnswerMs = $now - $speechEndedAt
      break
    }
    if ($display -match '(?s)\bError\s+([^\r\n]+)') {
      $result.ProviderError = $Matches[1]
    }
    Start-Sleep -Milliseconds 100
  }
} finally {
  if ($opened) {
    try {
      if ($wasManual) {
        Invoke-Button $window 'Manual (press to record)'
        Start-Sleep -Seconds 2
      }
      if ($wasMicOn -and $null -ne (Find-Button $window 'Mic Off')) {
        Invoke-Button $window 'Mic Off'
      }
      (Get-CaptureButton $window).GetCurrentPattern(
        [System.Windows.Automation.ExpandCollapsePattern]::Pattern
      ).Collapse()
    } catch {
      Write-Warning "Could not fully restore Listen controls: $_"
    }
  }
}

[pscustomobject]$result
if (-not $result.TranscriptDetected -or -not $result.AnswerVisible -or
    $null -eq $result.TotalAnswerMs -or $result.ProviderError) { exit 1 }
