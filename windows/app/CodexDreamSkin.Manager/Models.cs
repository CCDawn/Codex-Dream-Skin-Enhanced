using System.Text.Json;
using System.Text.Json.Serialization;

namespace CodexDreamSkin.Manager;

internal enum WallpaperKind
{
  Image,
  Video,
}

internal sealed record WallpaperItem(
  string Path,
  string Name,
  string Extension,
  WallpaperKind Kind,
  long Length,
  DateTime LastWriteTime)
{
  public string TypeLabel => Kind == WallpaperKind.Video ? "动态壁纸" : "静态壁纸";
  public string SizeLabel => Length >= 1024L * 1024L
    ? $"{Length / 1024d / 1024d:0.#} MB"
    : $"{Math.Max(1, Length / 1024d):0} KB";
}

internal sealed record DreamSkinStatus(
  bool WatcherRunning,
  bool CodexRunning,
  bool Paused,
  string? ActiveTheme,
  string? MediaPath,
  WallpaperKind? MediaKind,
  int RevealPercent)
{
  public string Summary => Paused
    ? "皮肤已暂停"
    : WatcherRunning
      ? "Codex 壁纸正在运行"
      : "等待启动";
}

internal sealed class AppSettings
{
  public string LibraryPath { get; set; } = SettingsStore.DefaultLibraryPath;
  public bool StartWithWindows { get; set; }
}

internal sealed class SettingsStore
{
  private static readonly JsonSerializerOptions JsonOptions = new()
  {
    WriteIndented = true,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
  };

  public static string DefaultLibraryPath => Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
    "Codex壁纸库");

  public SettingsStore()
  {
    SettingsPath = Path.Combine(
      Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
      "CodexDreamSkin",
      "manager-settings.json");
  }

  public string SettingsPath { get; }

  public AppSettings Load()
  {
    try
    {
      if (!File.Exists(SettingsPath))
      {
        return new AppSettings();
      }

      var settings = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(SettingsPath), JsonOptions)
        ?? new AppSettings();
      if (string.IsNullOrWhiteSpace(settings.LibraryPath))
      {
        settings.LibraryPath = DefaultLibraryPath;
      }
      return settings;
    }
    catch
    {
      return new AppSettings();
    }
  }

  public void Save(AppSettings settings)
  {
    var directory = Path.GetDirectoryName(SettingsPath)!;
    Directory.CreateDirectory(directory);
    var temporary = SettingsPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
    try
    {
      File.WriteAllText(temporary, JsonSerializer.Serialize(settings, JsonOptions));
      File.Move(temporary, SettingsPath, true);
    }
    finally
    {
      if (File.Exists(temporary))
      {
        File.Delete(temporary);
      }
    }
  }
}
