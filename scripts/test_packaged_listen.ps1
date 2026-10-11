<#
.SYNOPSIS
Run one spoken synthetic question through an already-running packaged Veil app.
.EXAMPLE
pwsh scripts/test_packaged_listen.ps1 -ProcessId 1234 -Question 'What is nine plus twelve?' -TranscriptPattern 'What is (9|nine) plus (12|twelve)' -AnswerPattern '21'
.EXAMPLE
pwsh scripts/test_packaged_listen.ps1 -ProcessId 1234 -Question 'What is nine plus twelve?' -TranscriptPattern 'What is (9|nine) plus (12|twelve)' -AnswerPattern '21' -AnswerNow
.EXAMPLE
pwsh scripts/test_packaged_listen.ps1 -ProcessId 1234 -Question 'I will send the file tomorrow.' -TranscriptPattern 'send (the|a) file tomorrow' -ExpectSilence
.EXAMPLE
pwsh scripts/test_packaged_listen.ps1 -ProcessId 1234 -Preamble 'You are choosing between a job and graduate study.' -PreamblePattern 'job and graduate' -Question 'You ask your teacher for guidance.' -TranscriptPattern 'ask your teacher' -ExpectSilence -JevShadow

The transcript and answer arguments are regular expressions. AnswerPattern is
matched anywhere in the active answer card, so a correct explanatory answer
may contain the expected value alongside other text.
JEV comparison stays shadow-only.
Inspect call_jev_shadow for the saved choice.
#>
param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [string]$Question = 'What is nine plus twelve?',
  [string]$TranscriptPattern = 'What is (9|nine) plus (12|twelve)',
  [string]$AnswerPattern = '21',
  [string]$Preamble = '',
  [string]$PreamblePattern = '',
  [string]$Guidance = '',
  [ValidateRange(0, 200)][int]$MinAnswerWords = 0,
  [ValidateRange(5, 90)][int]$TimeoutSeconds = 30,
  [switch]$AnswerNow,
  [switch]$ExpectSilence,
  [switch]$JevShadow,
  [switch]$FastOpenAI,
  [switch]$LeaveFastOpenAIOn,
  [switch]$GoDeeper,
  [switch]$Trace
)

if ($AnswerNow -and $ExpectSilence) {
  throw 'AnswerNow and ExpectSilence cannot be used together.'
}
if ($LeaveFastOpenAIOn -and -not $FastOpenAI) {
  throw 'LeaveFastOpenAIOn requires FastOpenAI.'
}
if ($GoDeeper -and $ExpectSilence) {
  throw 'GoDeeper and ExpectSilence cannot be used together.'
}
if ($Preamble -and -not $PreamblePattern) {
  throw 'PreamblePattern is required when Preamble is supplied.'
}

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class VeilTestMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
}
'@

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

function Find-GuidanceInput($window) {
  foreach ($element in (Get-Elements $window)) {
    if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and
        ($element.Current.AutomationId -eq 'listen-live-guidance' -or
         $element.Current.Name -match 'Guide answers until cleared')) {
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

function Get-SelectedAutoMode($window) {
  foreach ($name in @('Off', 'On question', 'Questions + requests')) {
    $button = Find-Button $window $name
    if ($null -ne $button -and $button.Current.ClassName -match 'bg-primary') {
      return $name
    }
  }
  throw 'The selected automatic-response mode could not be found.'
}

function Find-CaptureButton($window) {
  foreach ($element in (Get-Elements $window)) {
    $patterns = @($element.GetSupportedPatterns() | ForEach-Object ProgrammaticName)
    if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
        $element.Current.Name -eq '' -and
        ($patterns -contains 'ExpandCollapsePatternIdentifiers.Pattern')) {
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

function Click-CaptureButton($window) {
  $handle = (Get-Process -Id $ProcessId -ErrorAction Stop).MainWindowHandle
  [VeilTestMouse]::ShowWindow($handle, 9) | Out-Null
  [VeilTestMouse]::SetForegroundWindow($handle) | Out-Null
  Start-Sleep -Milliseconds 150
  $button = Get-CaptureButton $window
  $rect = $button.Current.BoundingRectangle
  if ($rect.Width -lt 10 -or $rect.Height -lt 10) {
    throw 'Listen capture control has no clickable bounds.'
  }
  $oldPosition = [System.Windows.Forms.Cursor]::Position
  try {
    $x = [int]($rect.Left + $rect.Width / 2)
    $y = [int]($rect.Top + $rect.Height / 2)
    [VeilTestMouse]::SetCursorPos($x, $y) | Out-Null
    [VeilTestMouse]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    [VeilTestMouse]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  } finally {
    [System.Windows.Forms.Cursor]::Position = $oldPosition
  }
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
    '(?is)Answering\s*[·:]\s*[^\r\n]+\s+Initial\s*[·:]\s*unverified\s*(?<answer>.*?)(?:\r?\nGo deeper|\r?\nLISTEN MODES|$)'
  )
  if ($matches.Count -eq 0) { return '' }
  return $matches[$matches.Count - 1].Groups['answer'].Value.Trim()
}

function Now-Milliseconds {
  return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}

$window = Get-Window
$opened = $false
$wasManual = $false
$wasMicOn = $false
$previousAutoMode = $null
$fastWasOn = $false
$jevWasOn = $false
$result = [ordered]@{
  Question = $Question
  TranscriptDetected = $false
  ManualFallbackClicked = $false
  AnswerStarted = $false
  AnswerVisible = $false
  GuidanceApplied = $false
  GuidancePersisted = $false
  GuidanceCleared = $false
  ClearTargetWidth = 0
  FinalAnswerWords = 0
  DeepTriggered = $false
  DeepCompleted = $false
  TranscriptVisibleMs = $null
  FirstAnswerVisibleMs = $null
  TotalAnswerMs = $null
  DeepCompletedMs = $null
  ProviderError = $null
  CaptureStopped = $false
}

try {
  if ((Get-DocumentText $window) -match 'Listening\.\.\.') {
    throw 'Start this test with Listen capture stopped, so the result belongs to one fresh session.'
  }
  Click-CaptureButton $window
  $opened = $true
  $startDeadline = (Now-Milliseconds) + 15000
  while ((Get-DocumentText $window) -notmatch 'Listening\.\.\.' -and
         (Now-Milliseconds) -lt $startDeadline) {
    Start-Sleep -Milliseconds 200
  }
  if ((Get-DocumentText $window) -notmatch 'Listening\.\.\.') {
    throw 'Listen did not start capturing after the button click.'
  }
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
  if ($FastOpenAI) {
    if ($null -eq (Find-Button $window 'Fast OpenAI answers')) {
      Invoke-Button $window 'Settings'
    }
    $fastToggle = Find-Button $window 'Fast OpenAI answers'
    if ($null -eq $fastToggle) { throw 'Fast OpenAI call-card switch was not found.' }
    $toggle = $fastToggle.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    $fastWasOn = $toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On
    if (-not $fastWasOn) { $toggle.Toggle() }
  }
  if ($JevShadow) {
    if ($null -eq (Find-Button $window 'JEV comparison (experimental)')) {
      Invoke-Button $window 'Settings'
    }
    $jev = Find-Button $window 'JEV comparison (experimental)'
    if ($null -eq $jev -or -not $jev.Current.IsEnabled) {
      throw 'JEV comparison requires a configured local TypeSafe key.'
    }
    $toggle = $jev.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    $jevWasOn = $toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On
    if (-not $jevWasOn) {
      $toggle.Toggle()
    }
  }
  if ($AnswerNow) {
    if ($null -eq (Find-Button $window 'Off')) { Invoke-Button $window 'Settings' }
    $previousAutoMode = Get-SelectedAutoMode $window
    if ($previousAutoMode -ne 'Off') { Invoke-Button $window 'Off' }
  }
  if ($Guidance) {
    $guideInput = Find-GuidanceInput $window
    if ($null -eq $guideInput) { throw 'The Listen guidance input was not found.' }
    $guideInput.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($Guidance)
    Start-Sleep -Milliseconds 250
    $guideInput = Find-GuidanceInput $window
    $result.GuidanceApplied = $guideInput.GetCurrentPattern(
      [System.Windows.Automation.ValuePattern]::Pattern
    ).Current.Value -eq $Guidance
    if (-not $result.GuidanceApplied) { throw 'Guidance did not remain in the input.' }
  }

  $voice = New-Object -ComObject SAPI.SpVoice
  $voice.Rate = 1
  if ($Preamble) {
    $null = $voice.Speak($Preamble)
    $preambleDeadline = (Now-Milliseconds) + 25000
    $preambleDetected = $false
    while ((Now-Milliseconds) -lt $preambleDeadline) {
      if ((Get-DocumentText $window) -match $PreamblePattern) {
        $preambleDetected = $true
        break
      }
      Start-Sleep -Milliseconds 150
    }
    if (-not $preambleDetected) { throw 'Synthetic preamble was not transcribed.' }
    Start-Sleep -Seconds 1
  }
  $baselineAnswerPrompt = Get-AnswerPrompt (Get-DocumentText $window)
  $null = $voice.Speak($Question)
  $speechEndedAt = Now-Milliseconds
  $deadline = $speechEndedAt + $(if ($ExpectSilence) {
    [Math]::Min($TimeoutSeconds, 8) * 1000
  } else {
    $TimeoutSeconds * 1000
  })

  while ((Now-Milliseconds) -lt $deadline) {
    $display = Get-DocumentText $window
    $now = Now-Milliseconds
    if (-not $result.TranscriptDetected -and $display -match $TranscriptPattern) {
      $result.TranscriptDetected = $true
      $result.TranscriptVisibleMs = $now - $speechEndedAt
    }
    if ($AnswerNow -and $result.TranscriptDetected -and -not $result.ManualFallbackClicked) {
      $manualButton = Find-Button $window 'Answer now'
      if ($null -ne $manualButton -and $manualButton.Current.IsEnabled) {
        $manualButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        $result.ManualFallbackClicked = $true
      }
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
    if ($result.AnswerVisible -and $display -match 'Go deeper' -and $null -eq $result.TotalAnswerMs) {
      if (-not $GoDeeper) {
        # An older card can still expose Go deeper. Wait for the new answer text
        # to arrive before treating this answer as complete.
        Start-Sleep -Milliseconds 1500
        $finalAnswer = Get-VisibleAnswerText (Get-DocumentText $window)
        $result.FinalAnswerWords = @($finalAnswer -split '\s+' | Where-Object { $_ }).Count
        if ($result.FinalAnswerWords -ge [Math]::Max(1, $MinAnswerWords) -and
            $finalAnswer -notmatch '^Generating response') {
          $result.TotalAnswerMs = (Now-Milliseconds) - $speechEndedAt
          break
        }
      } else {
        $result.TotalAnswerMs = $now - $speechEndedAt
      }
    }
    if ($GoDeeper -and $result.AnswerVisible -and -not $result.DeepTriggered) {
      $deepButton = Find-Button $window 'Go deeper'
      if ($null -ne $deepButton -and $deepButton.Current.IsEnabled) {
        $deepButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        $result.DeepTriggered = $true
      }
    }
    if ($result.DeepTriggered -and $display -match 'Deep draft\s*[·:]\s*not independently checked') {
      $result.DeepCompleted = $true
      $result.DeepCompletedMs = $now - $speechEndedAt
      break
    }
    if ($display -match '(?s)\bError\s+([^\r\n]+)') {
      $result.ProviderError = $Matches[1]
    }
    Start-Sleep -Milliseconds 100
  }
  if ($Guidance) {
    $guideInput = Find-GuidanceInput $window
    $guideValue = $guideInput.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
    if ($Trace) { Write-Host "TRACE guidance after answer=[$guideValue]" }
    $result.GuidancePersisted = $guideValue -eq $Guidance
    $clearButton = Find-Button $window 'Clear answer guidance'
    if ($null -eq $clearButton) { throw 'The guidance clear button was not found.' }
    $result.ClearTargetWidth = [Math]::Round($clearButton.Current.BoundingRectangle.Width)
    $clearButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    Start-Sleep -Milliseconds 250
    $guideInput = Find-GuidanceInput $window
    if ($Trace) { Write-Host "TRACE guidance after clear=[$($guideInput.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value)]" }
    $result.GuidanceCleared = $guideInput.GetCurrentPattern(
      [System.Windows.Automation.ValuePattern]::Pattern
    ).Current.Value -eq ''
  }
} finally {
  if ($opened) {
    try {
      if ($JevShadow -and -not $jevWasOn) {
        $jev = Find-Button $window 'JEV comparison (experimental)'
        if ($null -ne $jev) {
          $jevToggle = $jev.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
          if ($jevToggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On) {
            $jevToggle.Toggle()
          }
        }
      }
      if ($FastOpenAI -and -not $fastWasOn -and -not $LeaveFastOpenAIOn) {
        $fastToggle = Find-Button $window 'Fast OpenAI answers'
        if ($null -ne $fastToggle) {
          $toggle = $fastToggle.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
          if ($toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On) {
            $toggle.Toggle()
          }
        }
      }
      if ($null -ne $previousAutoMode -and $previousAutoMode -ne 'Off') {
        Invoke-Button $window $previousAutoMode
      }
      if ($wasManual) {
        Invoke-Button $window 'Manual (press to record)'
        Start-Sleep -Seconds 2
      }
      if ($wasMicOn -and $null -ne (Find-Button $window 'Mic Off')) {
        Invoke-Button $window 'Mic Off'
      }
      if ((Get-DocumentText $window) -match 'Listening\.\.\.') {
        Click-CaptureButton $window
      }
      $settleDeadline = (Now-Milliseconds) + 5000
      do {
        Start-Sleep -Milliseconds 250
        $stillListening = (Get-DocumentText $window) -match 'Listening\.\.\.'
      } while ($stillListening -and
               (Now-Milliseconds) -lt $settleDeadline)
      if ($stillListening) {
        Write-Warning 'Listen capture did not confirm stopped after the test.'
      }
      $result.CaptureStopped = -not $stillListening
    } catch {
      Write-Warning "Could not fully restore Listen controls: $_"
    }
  }
}

[pscustomobject]$result
if ($ExpectSilence) {
  if (-not $result.TranscriptDetected -or $result.AnswerStarted -or $result.ProviderError -or
      -not $result.CaptureStopped) { exit 1 }
  exit 0
}
if (-not $result.TranscriptDetected -or -not $result.AnswerVisible -or
    $null -eq $result.TotalAnswerMs -or $result.ProviderError -or
    -not $result.CaptureStopped -or
    $result.FinalAnswerWords -lt $MinAnswerWords -or
    ($Guidance -and (-not $result.GuidancePersisted -or -not $result.GuidanceCleared -or
      $result.ClearTargetWidth -lt 30)) -or
    ($AnswerNow -and -not $result.ManualFallbackClicked) -or
    ($GoDeeper -and -not $result.DeepCompleted)) { exit 1 }
