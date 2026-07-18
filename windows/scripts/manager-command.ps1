[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('SetWallpaper', 'SetReveal', 'Pause', 'Resume', 'Status')]
  [string]$Action,
  [string]$Path,
  [ValidateRange(0, 100)]
  [int]$Percent = 100,
  [string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'CodexDreamSkin')
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common-windows.ps1')
. (Join-Path $PSScriptRoot 'theme-windows.ps1')

$paths = Get-DreamSkinThemePaths -StateRoot $StateRoot

switch ($Action) {
  'SetWallpaper' {
    if (-not $Path) { throw 'SetWallpaper requires -Path.' }
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $theme = $null
    if (Test-Path -LiteralPath $paths.Active -PathType Container) {
      try {
        $theme = (Read-DreamSkinTheme -ThemeDirectory $paths.Active -SkipImageMetadata).Theme
      } catch {
        $theme = $null
      }
    }
    $result = Set-DreamSkinActiveTheme -ImagePath $fullPath -Theme $theme `
      -Name ([System.IO.Path]::GetFileNameWithoutExtension($fullPath)) -StateRoot $StateRoot
    [pscustomobject]@{
      action = $Action
      mediaPath = $result.MediaPath
      mediaType = $result.MediaType
      name = $result.Theme.name
      reveal = Get-DreamSkinThemeMediaOpacity -Theme $result.Theme
    } | ConvertTo-Json -Depth 5
  }
  'SetReveal' {
    $result = Set-DreamSkinActiveThemeMediaOpacity -Opacity ([double]$Percent / 100) `
      -StateRoot $StateRoot
    [pscustomobject]@{
      action = $Action
      percent = $Percent
      reveal = Get-DreamSkinThemeMediaOpacity -Theme $result.Theme
    } | ConvertTo-Json -Depth 5
  }
  'Pause' {
    Set-DreamSkinPaused -Paused $true -StateRoot $StateRoot | Out-Null
    [pscustomobject]@{ action = $Action; paused = $true } | ConvertTo-Json
  }
  'Resume' {
    Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
    [pscustomobject]@{ action = $Action; paused = $false } | ConvertTo-Json
  }
  'Status' {
    $active = $null
    if (Test-Path -LiteralPath $paths.Active -PathType Container) {
      try {
        $active = Read-DreamSkinTheme -ThemeDirectory $paths.Active -SkipImageMetadata
      } catch {
        $active = $null
      }
    }
    [pscustomobject]@{
      action = $Action
      paused = Test-DreamSkinPaused -StateRoot $StateRoot
      activeTheme = if ($null -ne $active) { $active.Theme.name } else { $null }
      mediaPath = if ($null -ne $active) { $active.MediaPath } else { $null }
      mediaType = if ($null -ne $active) { $active.MediaType } else { $null }
      reveal = if ($null -ne $active) {
        Get-DreamSkinThemeMediaOpacity -Theme $active.Theme
      } else { [double]1 }
    } | ConvertTo-Json -Depth 5
  }
}
