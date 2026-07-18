using System.Runtime.InteropServices;

namespace CodexDreamSkin.Manager;

internal static class ShellThumbnail
{
  [Flags]
  private enum ThumbnailOptions
  {
    BiggerSizeOk = 0x1,
    ThumbnailOnly = 0x8,
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct NativeSize
  {
    public int Width;
    public int Height;
  }

  [ComImport]
  [Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItemImageFactory
  {
    void GetImage(
      [In] NativeSize size,
      [In] ThumbnailOptions flags,
      out IntPtr bitmapHandle);
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  private static extern void SHCreateItemFromParsingName(
    [MarshalAs(UnmanagedType.LPWStr)] string path,
    IntPtr bindingContext,
    [In] ref Guid interfaceId,
    [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory imageFactory);

  [DllImport("gdi32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool DeleteObject(IntPtr handle);

  public static Image? Get(string path, int width, int height)
  {
    try
    {
      var id = typeof(IShellItemImageFactory).GUID;
      SHCreateItemFromParsingName(path, IntPtr.Zero, ref id, out var factory);
      factory.GetImage(
        new NativeSize { Width = width, Height = height },
        ThumbnailOptions.ThumbnailOnly | ThumbnailOptions.BiggerSizeOk,
        out var bitmapHandle);
      try
      {
        using var source = Image.FromHbitmap(bitmapHandle);
        return new Bitmap(source);
      }
      finally
      {
        DeleteObject(bitmapHandle);
        Marshal.FinalReleaseComObject(factory);
      }
    }
    catch
    {
      if (WallpaperCatalog.GetKind(path) == WallpaperKind.Video)
      {
        return null;
      }

      try
      {
        using var source = Image.FromFile(path);
        return new Bitmap(source);
      }
      catch
      {
        return null;
      }
    }
  }
}
