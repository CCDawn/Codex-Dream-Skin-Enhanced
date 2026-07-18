namespace CodexDreamSkin.Manager;

internal sealed class WallpaperCatalog
{
  private static readonly HashSet<string> ImageExtensions =
    new(StringComparer.OrdinalIgnoreCase) { ".png", ".jpg", ".jpeg", ".webp" };
  private static readonly HashSet<string> VideoExtensions =
    new(StringComparer.OrdinalIgnoreCase) { ".mp4", ".webm" };

  public static bool IsSupported(string path)
  {
    var extension = Path.GetExtension(path);
    return ImageExtensions.Contains(extension) || VideoExtensions.Contains(extension);
  }

  public static WallpaperKind GetKind(string path) =>
    VideoExtensions.Contains(Path.GetExtension(path)) ? WallpaperKind.Video : WallpaperKind.Image;

  public Task<IReadOnlyList<WallpaperItem>> LoadAsync(
    string libraryPath,
    string? search,
    CancellationToken cancellationToken = default)
  {
    return Task.Run<IReadOnlyList<WallpaperItem>>(() =>
    {
      if (!Directory.Exists(libraryPath))
      {
        return Array.Empty<WallpaperItem>();
      }

      var options = new EnumerationOptions
      {
        RecurseSubdirectories = true,
        IgnoreInaccessible = true,
        ReturnSpecialDirectories = false,
        AttributesToSkip = FileAttributes.ReparsePoint | FileAttributes.System,
      };
      var normalizedSearch = search?.Trim();
      var items = new List<WallpaperItem>();
      foreach (var path in Directory.EnumerateFiles(libraryPath, "*", options))
      {
        cancellationToken.ThrowIfCancellationRequested();
        if (!IsSupported(path))
        {
          continue;
        }

        var name = Path.GetFileNameWithoutExtension(path);
        if (!string.IsNullOrWhiteSpace(normalizedSearch) &&
            !name.Contains(normalizedSearch, StringComparison.CurrentCultureIgnoreCase) &&
            !path.Contains(normalizedSearch, StringComparison.CurrentCultureIgnoreCase))
        {
          continue;
        }

        try
        {
          var info = new FileInfo(path);
          items.Add(new WallpaperItem(
            info.FullName,
            name,
            info.Extension.ToUpperInvariant(),
            GetKind(info.FullName),
            info.Length,
            info.LastWriteTime));
        }
        catch (IOException)
        {
          // A single file changing during discovery must not hide the rest of the library.
        }
      }

      return items
        .OrderByDescending(item => item.LastWriteTime)
        .ThenBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase)
        .Take(500)
        .ToArray();
    }, cancellationToken);
  }
}
