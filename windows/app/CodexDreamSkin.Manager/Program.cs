using System.Reflection;

namespace CodexDreamSkin.Manager;

internal static class Program
{
  private const string MutexName = @"Local\CodexDreamSkin.Manager";

  [STAThread]
  private static int Main(string[] args)
  {
    using var mutex = new Mutex(true, MutexName, out var createdNew);
    if (!createdNew && !args.Contains("--self-test", StringComparer.OrdinalIgnoreCase))
    {
      MessageBox.Show(
        "Codex Dream Skin Manager 已经在运行，请查看任务栏托盘。",
        "Codex Dream Skin",
        MessageBoxButtons.OK,
        MessageBoxIcon.Information);
      return 0;
    }

    try
    {
      var runtime = new RuntimeProvisioner();
      runtime.EnsureExtracted();

      if (args.Contains("--self-test", StringComparer.OrdinalIgnoreCase))
      {
        return SelfTest.Run(runtime);
      }

      Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
      Application.EnableVisualStyles();
      Application.SetCompatibleTextRenderingDefault(false);

      var settings = new SettingsStore();
      var service = new DreamSkinService(runtime);
      var minimized = args.Contains("--minimized", StringComparer.OrdinalIgnoreCase);
      Application.Run(new MainForm(service, settings, minimized));
      return 0;
    }
    catch (Exception exception)
    {
      var logPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "CodexDreamSkin",
        "manager-error.log");
      try
      {
        Directory.CreateDirectory(Path.GetDirectoryName(logPath)!);
        File.AppendAllText(logPath, $"[{DateTimeOffset.Now:O}] {exception}\r\n");
      }
      catch
      {
        // The original exception is more important than secondary logging.
      }

      MessageBox.Show(
        $"启动失败：{exception.Message}\r\n\r\n日志：{logPath}",
        "Codex Dream Skin",
        MessageBoxButtons.OK,
        MessageBoxIcon.Error);
      return 1;
    }
  }
}

internal static class SelfTest
{
  public static int Run(RuntimeProvisioner runtime)
  {
    try
    {
      runtime.ValidateExtractedPayload();
      if (!WallpaperCatalog.IsSupported("sample.mp4") ||
          !WallpaperCatalog.IsSupported("sample.webp") ||
          WallpaperCatalog.IsSupported("sample.exe"))
      {
        return 2;
      }

      var version = Assembly.GetExecutingAssembly().GetName().Version;
      return version is null ? 3 : 0;
    }
    catch
    {
      return 4;
    }
  }
}
