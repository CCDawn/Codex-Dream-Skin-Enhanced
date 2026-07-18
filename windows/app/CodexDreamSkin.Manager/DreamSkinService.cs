using System.Diagnostics;
using System.Text.Json;

namespace CodexDreamSkin.Manager;

internal sealed class DreamSkinService
{
  private readonly RuntimeProvisioner _runtime;
  private readonly PowerShellRunner _runner;

  public DreamSkinService(RuntimeProvisioner runtime)
  {
    _runtime = runtime;
    _runner = new PowerShellRunner(runtime);
  }

  public async Task StartAsync(CancellationToken cancellationToken = default)
  {
    var result = await _runner.RunScriptAsync(
      _runtime.StartScript,
      new[] { "-Port", "9335", "-PromptRestart" },
      cancellationToken);
    result.ThrowIfFailed("启动 Dream Skin");
  }

  public async Task ApplyWallpaperAsync(string path, CancellationToken cancellationToken = default)
  {
    if (!File.Exists(path) || !WallpaperCatalog.IsSupported(path))
    {
      throw new InvalidOperationException("请选择有效的 PNG、JPEG、WebP、MP4 或 WebM 文件。");
    }

    var result = await RunManagerCommandAsync(
      new[] { "-Action", "SetWallpaper", "-Path", path },
      cancellationToken);
    result.ThrowIfFailed("切换壁纸");

    var status = GetStatus();
    if (!status.WatcherRunning)
    {
      await StartAsync(cancellationToken);
    }
  }

  public async Task SetRevealAsync(int percent, CancellationToken cancellationToken = default)
  {
    if (percent is < 0 or > 100)
    {
      throw new ArgumentOutOfRangeException(nameof(percent));
    }
    var result = await RunManagerCommandAsync(
      new[] { "-Action", "SetReveal", "-Percent", percent.ToString() },
      cancellationToken);
    result.ThrowIfFailed("调整壁纸透出程度");
  }

  public async Task SetPausedAsync(bool paused, CancellationToken cancellationToken = default)
  {
    var result = await RunManagerCommandAsync(
      new[] { "-Action", paused ? "Pause" : "Resume" },
      cancellationToken);
    result.ThrowIfFailed(paused ? "暂停皮肤" : "恢复皮肤");
  }

  public async Task RestoreAsync(CancellationToken cancellationToken = default)
  {
    var result = await _runner.RunScriptAsync(
      _runtime.RestoreScript,
      new[] { "-Port", "9335", "-RestoreBaseTheme", "-PromptRestart" },
      cancellationToken);
    result.ThrowIfFailed("恢复 Codex 官方外观");
  }

  public DreamSkinStatus GetStatus()
  {
    var statePath = Path.Combine(_runtime.StateRoot, "state.json");
    var themePath = Path.Combine(_runtime.StateRoot, "active-theme", "theme.json");
    var paused = File.Exists(Path.Combine(_runtime.StateRoot, "paused"));
    var watcherRunning = false;
    string? activeTheme = null;
    string? mediaPath = null;
    WallpaperKind? mediaKind = null;
    var reveal = 100;

    try
    {
      if (File.Exists(statePath))
      {
        using var state = JsonDocument.Parse(File.ReadAllText(statePath));
        if (state.RootElement.TryGetProperty("injectorPid", out var pidElement) &&
            pidElement.TryGetInt32(out var pid))
        {
          try
          {
            using var process = Process.GetProcessById(pid);
            watcherRunning = !process.HasExited &&
              process.ProcessName.Equals("node", StringComparison.OrdinalIgnoreCase);
          }
          catch
          {
            watcherRunning = false;
          }
        }
      }

      if (File.Exists(themePath))
      {
        using var theme = JsonDocument.Parse(File.ReadAllText(themePath));
        if (theme.RootElement.TryGetProperty("name", out var nameElement))
        {
          activeTheme = nameElement.GetString();
        }
        if (theme.RootElement.TryGetProperty("image", out var imageElement))
        {
          var image = imageElement.GetString();
          if (!string.IsNullOrWhiteSpace(image))
          {
            mediaPath = Path.Combine(Path.GetDirectoryName(themePath)!, image);
            mediaKind = WallpaperCatalog.GetKind(mediaPath);
          }
        }
        if (theme.RootElement.TryGetProperty("media", out var mediaElement) &&
            mediaElement.TryGetProperty("opacity", out var opacityElement) &&
            opacityElement.TryGetDouble(out var opacity))
        {
          reveal = Math.Clamp((int)Math.Round(opacity * 100), 0, 100);
        }
      }
    }
    catch
    {
      // Status rendering stays available even if an external process is replacing state atomically.
    }

    var codexRunning = IsAnyProcessRunning("ChatGPT") ||
      IsAnyProcessRunning("Codex");
    return new DreamSkinStatus(
      watcherRunning,
      codexRunning,
      paused,
      activeTheme,
      mediaPath,
      mediaKind,
      reveal);
  }

  private Task<ProcessResult> RunManagerCommandAsync(
    IEnumerable<string> arguments,
    CancellationToken cancellationToken) =>
    _runner.RunScriptAsync(_runtime.ManagerCommandScript, arguments, cancellationToken);

  private static bool IsAnyProcessRunning(string processName)
  {
    var processes = Process.GetProcessesByName(processName);
    try
    {
      return processes.Any(process => !process.HasExited);
    }
    finally
    {
      foreach (var process in processes)
      {
        process.Dispose();
      }
    }
  }
}
