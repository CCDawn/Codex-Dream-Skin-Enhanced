using Microsoft.Win32;

namespace CodexDreamSkin.Manager;

internal static class AutoStartManager
{
  private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
  private const string ValueName = "CodexDreamSkinManager";

  public static bool IsEnabled()
  {
    using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, false);
    return key?.GetValue(ValueName) is string value &&
      value.Contains(Environment.ProcessPath ?? string.Empty, StringComparison.OrdinalIgnoreCase);
  }

  public static void SetEnabled(bool enabled)
  {
    using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath, true)
      ?? throw new InvalidOperationException("无法打开当前用户启动项。");
    if (enabled)
    {
      var executable = Environment.ProcessPath
        ?? throw new InvalidOperationException("无法确定管理器 EXE 路径。");
      key.SetValue(ValueName, $"\"{executable}\" --minimized", RegistryValueKind.String);
    }
    else
    {
      key.DeleteValue(ValueName, false);
    }
  }
}
