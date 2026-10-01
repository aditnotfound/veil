<#
.SYNOPSIS
Run one spoken synthetic question through an already-running packaged Veil app.
.EXAMPLE
pwsh scripts/test_packaged_listen.ps1 -ProcessId 1234 -Question 'What is nine plus twelve?' -TranscriptPattern 'What is (9|nine) plus (12|twelve)' -AnswerPattern '21'
.EXAMPLE
pwsh scripts/test_packaged_listen.ps1 -ProcessId 1234 -Question 'What is nine plus twelve?' -TranscriptPattern 'What is (9|nine) plus (12|twelve)' -AnswerPattern '21' -AnswerNow
.EXAMPLE
pwsh scripts/test_packaged_listen.ps1 -ProcessId 1234 -Question 'I will send the file tomorrow.' -TranscriptPattern 'send the file tomorrow' -ExpectSilence
.EXAMPLE
pwsh scripts/test_packaged_listen.ps1 -ProcessId 1234 -Preamble 'You are choosing between a job and graduate study.' -PreamblePattern 'job and graduate' -Question 'You ask your teacher for guidance.' -TranscriptPattern 'ask your teacher' -ExpectSilence -JevShadow

The transcript and answer arguments are regular expressions. AnswerPattern is
matched anywhere in the active answer card, so a correct explanatory answer
may contain the expected value alongside other text.
JEV comparison stays shadow-only unless -JevAssist is also passed.
Inspect call_jev_shadow for the saved choice.
#>
param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [string]$Question = 'What is nine plus twelve?',
  [string]$TranscriptPattern = 'What is (9|nine) plus (12|twelve)',
  [string]$AnswerPattern = '21',
  [string]$Preamble = '',
  [string]$PreamblePattern = '',
  [ValidateRange(5, 90)][int]$TimeoutSeconds = 30,
  [switch]$AnswerNow,
  [switch]$ExpectSilence,
  [switch]$JevShadow,
  [switch]$JevAssist,
  [switch]$FastOpenAI,
  [switch]$LeaveFastOpenAIOn,
  [switch]$GoDeeper,
  [switch]$Trace
)

if ($AnswerNow -and $ExpectSilence) {
  throw 'AnswerNow and ExpectSilence cannot be used together.'
}
if ($JevAssist -and -not $JevShadow) {
  throw 'JevAssist requires JevShadow.'
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
$previousAutoMode = $null
$fastWasOn = $false
$assistWasOn = $false
$result = [ordered]@{
  Question = $Question
  TranscriptDetected = $false
  ManualFallbackClicked = $false
  AnswerStarted = $false
  AnswerVisible = $false
  DeepTriggered = $false
  DeepCompleted = $false
  TranscriptVisibleMs = $null
  FirstAnswerVisibleMs = $null
  TotalAnswerMs = $null
  DeepCompletedMs = $null
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
  if ($FastOpenAI) {
    if ($null -eq (Find-Button $window 'Fast OpenAI call answers')) {
      Invoke-Button $window 'Settings'
    }
    $fastToggle = Find-Button $window 'Fast OpenAI call answers'
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
    if ($toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::Off) {
      $toggle.Toggle()
    }
    if ($JevAssist) {
      $assist = Find-Button $window 'Let JEV rescue unclear questions'
      if ($null -eq $assist -or -not $assist.Current.IsEnabled) {
        throw 'JEV live-assist switch was not available.'
      }
      $assistToggle = $assist.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
      $assistWasOn = $assistToggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On
      if (-not $assistWasOn) { $assistToggle.Toggle() }
    }
  }
  if ($AnswerNow) {
    if ($null -eq (Find-Button $window 'Off')) { Invoke-Button $window 'Settings' }
    $previousAutoMode = Get-SelectedAutoMode $window
    if ($previousAutoMode -ne 'Off') { Invoke-Button $window 'Off' }
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
      $result.TotalAnswerMs = $now - $speechEndedAt
      if (-not $GoDeeper) {
        # Let the short stream finish before collapsing capture, which cancels in-flight work.
        Start-Sleep -Milliseconds 1500
        break
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
} finally {
  if ($opened) {
    try {
      if ($JevAssist -and -not $assistWasOn) {
        $assist = Find-Button $window 'Let JEV rescue unclear questions'
        if ($null -ne $assist) {
          $assistToggle = $assist.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
          if ($assistToggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On) {
            $assistToggle.Toggle()
          }
        }
      }
      if ($FastOpenAI -and -not $fastWasOn -and -not $LeaveFastOpenAIOn) {
        $fastToggle = Find-Button $window 'Fast OpenAI call answers'
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
      (Get-CaptureButton $window).GetCurrentPattern(
        [System.Windows.Automation.ExpandCollapsePattern]::Pattern
      ).Collapse()
    } catch {
      Write-Warning "Could not fully restore Listen controls: $_"
    }
  }
}

[pscustomobject]$result
if ($ExpectSilence) {
  if (-not $result.TranscriptDetected -or $result.AnswerStarted -or $result.ProviderError) { exit 1 }
  exit 0
}
if (-not $result.TranscriptDetected -or -not $result.AnswerVisible -or
    $null -eq $result.TotalAnswerMs -or $result.ProviderError -or
    ($AnswerNow -and -not $result.ManualFallbackClicked) -or
    ($GoDeeper -and -not $result.DeepCompleted)) { exit 1 }
