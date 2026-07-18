[CmdletBinding()]
param([int]$Port = 9335)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic
. (Join-Path $PSScriptRoot 'common-windows.ps1')
. (Join-Path $PSScriptRoot 'theme-windows.ps1')

Assert-DreamSkinPort -Port $Port
$SkillRoot = Split-Path -Parent $PSScriptRoot
$StateRoot = Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'
$paths = Initialize-DreamSkinThemeStore -SkillRoot $SkillRoot -StateRoot $StateRoot
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$startScript = Join-Path $PSScriptRoot 'start-dream-skin.ps1'
$restoreScript = Join-Path $PSScriptRoot 'restore-dream-skin.ps1'

$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$mutex = [System.Threading.Mutex]::new($false, "Local\CodexDreamSkin.$sid.Tray")
$acquired = $false
try {
  try { $acquired = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $acquired = $true }
  if (-not $acquired) { exit 0 }

  $notify = [System.Windows.Forms.NotifyIcon]::new()
  $notify.Icon = [System.Drawing.SystemIcons]::Application
  $notify.Text = 'Codex 动态壁纸'
  $notify.Visible = $true
  $menu = [System.Windows.Forms.ContextMenuStrip]::new()
  $notify.ContextMenuStrip = $menu

  function Show-DreamSkinTrayError {
    param([string]$Message)
    [void][System.Windows.Forms.MessageBox]::Show(
      $Message,
      'Codex 动态壁纸',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    )
  }

  function Start-DreamSkinPowerShell {
    param([Parameter(Mandatory = $true)][string]$Script, [string[]]$Arguments = @())
    $scriptToken = ConvertTo-DreamSkinProcessArgument -Value $Script
    $argumentLine = '-NoProfile -ExecutionPolicy Bypass -File ' + $scriptToken
    if ($Arguments.Count -gt 0) { $argumentLine += ' ' + ($Arguments -join ' ') }
    Start-Process -FilePath $powershell -ArgumentList $argumentLine | Out-Null
  }

  function Add-DreamSkinTrayItem {
    param(
      [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Windows.Forms.ToolStripItemCollection]$Items,
      [Parameter(Mandatory = $true)][string]$Text,
      [AllowNull()][scriptblock]$Action,
      [bool]$Enabled = $true
    )
    $item = [System.Windows.Forms.ToolStripMenuItem]::new($Text)
    $item.Enabled = $Enabled
    if ($null -ne $Action) {
      $item.add_Click({
        try { & $Action } catch { Show-DreamSkinTrayError -Message $_.Exception.Message }
      }.GetNewClosure())
    }
    [void]$Items.Add($item)
    return $item
  }

  function Add-DreamSkinRevealControl {
    param(
      [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Windows.Forms.ToolStripItemCollection]$Items,
      [Parameter(Mandatory = $true)][object]$Theme
    )
    $percent = Get-DreamSkinThemeMediaRevealPercent -Theme $Theme
    $label = [System.Windows.Forms.ToolStripLabel]::new("壁纸透出：$percent%")
    $label.Margin = [System.Windows.Forms.Padding]::new(8, 3, 8, 0)
    [void]$Items.Add($label)

    $trackBar = [System.Windows.Forms.TrackBar]::new()
    $trackBar.Minimum = 0
    $trackBar.Maximum = 100
    $trackBar.Value = $percent
    $trackBar.TickFrequency = 10
    $trackBar.SmallChange = 5
    $trackBar.LargeChange = 10
    $trackBar.AutoSize = $false
    $trackBar.Size = [System.Drawing.Size]::new(250, 38)
    $trackBar.AccessibleName = '壁纸透出程度'

    $updateLabel = {
      $label.Text = "壁纸透出：$($trackBar.Value)%"
    }.GetNewClosure()
    $commitReveal = {
      try {
        $label.Text = "壁纸透出：$($trackBar.Value)%"
        $null = Set-DreamSkinActiveThemeMediaOpacity `
          -Opacity (ConvertTo-DreamSkinMediaOpacityFromRevealPercent -Percent $trackBar.Value) `
          -StateRoot $StateRoot
      } catch {
        Show-DreamSkinTrayError -Message $_.Exception.Message
      }
    }.GetNewClosure()
    $trackBar.add_Scroll($updateLabel)
    $trackBar.add_MouseUp($commitReveal)
    $trackBar.add_KeyUp($commitReveal)

    $controlHost = [System.Windows.Forms.ToolStripControlHost]::new($trackBar)
    $controlHost.AutoSize = $false
    $controlHost.Size = [System.Drawing.Size]::new(270, 42)
    $controlHost.Margin = [System.Windows.Forms.Padding]::new(4, 0, 4, 4)
    [void]$Items.Add($controlHost)
  }

  function Rebuild-DreamSkinTrayMenu {
    $menu.Items.Clear()
    $paused = Test-DreamSkinPaused -StateRoot $StateRoot
    $state = $null
    try { $state = Read-DreamSkinState -Path $paths.State } catch {}
    $active = $null
    try { $active = Read-DreamSkinTheme -ThemeDirectory $paths.Active -SkipImageMetadata } catch {}
    $status = if ($paused) { '状态：已暂停' } elseif ($state) { '状态：运行中' } else { '状态：未运行' }
    if ($null -ne $active -and $null -ne $active.Theme -and $active.Theme.name) {
      $status += " · $($active.Theme.name)"
    }
    $null = Add-DreamSkinTrayItem -Items $menu.Items -Text $status -Action $null -Enabled $false
    if ($null -ne $active -and $null -ne $active.Theme) {
      Add-DreamSkinRevealControl -Items $menu.Items -Theme $active.Theme
    }
    [void]$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new())

    $null = Add-DreamSkinTrayItem -Items $menu.Items -Text '应用或重新应用' -Action {
      Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
      Start-DreamSkinPowerShell -Script $startScript -Arguments @('-Port', "$Port", '-PromptRestart')
    }
    $pauseText = if ($paused) { '继续显示皮肤' } else { '暂停皮肤' }
    $nextPaused = -not $paused
    $pauseAction = {
      Set-DreamSkinPaused -Paused $nextPaused -StateRoot $StateRoot | Out-Null
    }.GetNewClosure()
    $null = Add-DreamSkinTrayItem -Items $menu.Items -Text $pauseText -Action $pauseAction
    $null = Add-DreamSkinTrayItem -Items $menu.Items -Text '更换背景图或视频' -Action {
      $dialog = [System.Windows.Forms.OpenFileDialog]::new()
      $dialog.Title = '选择 Codex 动态壁纸图片或视频'
      $dialog.Filter = 'Wallpaper files|*.png;*.jpg;*.jpeg;*.webp;*.mp4;*.webm|Image files|*.png;*.jpg;*.jpeg;*.webp|Video files|*.mp4;*.webm|All files|*.*'
      $dialog.Multiselect = $false
      try {
        if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
          $null = Set-DreamSkinActiveTheme -ImagePath $dialog.FileName -Theme $null -StateRoot $StateRoot
          Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
          $notify.ShowBalloonTip(1800, 'Codex 动态壁纸', '背景素材已更新。', [System.Windows.Forms.ToolTipIcon]::Info)
        }
      } finally {
        $dialog.Dispose()
      }
    }
    $null = Add-DreamSkinTrayItem -Items $menu.Items -Text '保存当前主题' -Action {
      $name = [Microsoft.VisualBasic.Interaction]::InputBox('输入主题名称：', '保存 Codex 动态壁纸主题', '')
      if ($name.Trim()) {
        $saved = Save-DreamSkinCurrentTheme -Name $name -StateRoot $StateRoot
        $notify.ShowBalloonTip(1800, 'Codex 动态壁纸', "已保存：$($saved.Theme.name)", [System.Windows.Forms.ToolTipIcon]::Info)
      }
    }

    $savedMenu = [System.Windows.Forms.ToolStripMenuItem]::new('已保存主题')
    $savedThemes = @(Get-DreamSkinSavedThemes -StateRoot $StateRoot -SkipImageMetadata)
    if ($savedThemes.Count -eq 0) {
      $empty = [System.Windows.Forms.ToolStripMenuItem]::new('暂无已保存主题')
      $empty.Enabled = $false
      [void]$savedMenu.DropDownItems.Add($empty)
    } else {
      foreach ($saved in $savedThemes) {
        $savedPath = $saved.Path
        $savedName = $saved.Name
        $savedAction = {
          $null = Use-DreamSkinSavedTheme -ThemeDirectory $savedPath -StateRoot $StateRoot
          Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
          $notify.ShowBalloonTip(1800, 'Codex 动态壁纸', "已应用：$savedName", [System.Windows.Forms.ToolTipIcon]::Info)
        }.GetNewClosure()
        $null = Add-DreamSkinTrayItem -Items $savedMenu.DropDownItems -Text $savedName -Action $savedAction
      }
    }
    [void]$menu.Items.Add($savedMenu)

    $null = Add-DreamSkinTrayItem -Items $menu.Items -Text '打开素材文件夹' -Action {
      Start-Process -FilePath explorer.exe -ArgumentList @($paths.Images) | Out-Null
    }
    [void]$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new())
    $null = Add-DreamSkinTrayItem -Items $menu.Items -Text '完全恢复 Codex' -Action {
      Start-DreamSkinPowerShell -Script $restoreScript -Arguments @(
        '-Port', "$Port", '-RestoreBaseTheme', '-PromptRestart'
      )
      $notify.Visible = $false
      [System.Windows.Forms.Application]::Exit()
    }
    $null = Add-DreamSkinTrayItem -Items $menu.Items -Text '退出托盘' -Action {
      $notify.Visible = $false
      [System.Windows.Forms.Application]::Exit()
    }
  }

  $menu.add_Opening({ Rebuild-DreamSkinTrayMenu })
  $notify.add_DoubleClick({
    try {
      Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
      Start-DreamSkinPowerShell -Script $startScript -Arguments @('-Port', "$Port", '-PromptRestart')
    } catch {
      Show-DreamSkinTrayError -Message $_.Exception.Message
    }
  })
  [System.Windows.Forms.Application]::Run()
} finally {
  if ($null -ne $notify) { $notify.Dispose() }
  if ($acquired) { try { $mutex.ReleaseMutex() } catch {} }
  $mutex.Dispose()
}
