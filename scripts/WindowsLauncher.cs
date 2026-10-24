using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyVersion("__ASSEMBLY_VERSION__")]
[assembly: AssemblyFileVersion("__ASSEMBLY_VERSION__")]
[assembly: AssemblyProduct("Loopframe")]

internal static class Program
{
    private const string Version = "__VERSION__";

    [STAThread]
    private static int Main(string[] args)
    {
        string root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Loopframe",
            "app",
            Version);
        string executable = Path.Combine(root, "Loopframe.exe");
        string marker = Path.Combine(root, ".ready");

        using (Mutex mutex = new Mutex(false, @"Local\Loopframe.Launcher." + Version))
        {
            bool acquired = false;
            try
            {
                acquired = mutex.WaitOne(TimeSpan.FromMinutes(2));
                if (!acquired)
                {
                    ShowError("Loopframe is still preparing its local runtime. Try again in a moment.");
                    return 2;
                }

                if (!File.Exists(executable) || !File.Exists(marker))
                {
                    ExtractApplication(root);
                }
            }
            catch (Exception error)
            {
                ShowError("Loopframe could not prepare its local runtime.\n\n" + error.Message);
                return 1;
            }
            finally
            {
                if (acquired) mutex.ReleaseMutex();
            }
        }

        try
        {
            ProcessStartInfo start = new ProcessStartInfo(executable);
            start.WorkingDirectory = root;
            start.UseShellExecute = true;
            start.Arguments = QuoteArguments(args);
            Process.Start(start);
            return 0;
        }
        catch (Exception error)
        {
            ShowError("Loopframe could not start.\n\n" + error.Message);
            return 1;
        }
    }

    private static void ExtractApplication(string root)
    {
        string staging = root + ".extracting-" + Process.GetCurrentProcess().Id;
        if (Directory.Exists(staging)) Directory.Delete(staging, true);
        Directory.CreateDirectory(staging);

        Assembly assembly = Assembly.GetExecutingAssembly();
        using (Stream resource = assembly.GetManifestResourceStream("Loopframe.App.zip"))
        {
            if (resource == null) throw new InvalidOperationException("The application package is missing.");
            using (ZipArchive archive = new ZipArchive(resource, ZipArchiveMode.Read))
            {
                string stagingRoot = Path.GetFullPath(staging) + Path.DirectorySeparatorChar;
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    string destination = Path.GetFullPath(Path.Combine(staging, entry.FullName));
                    if (!destination.StartsWith(stagingRoot, StringComparison.OrdinalIgnoreCase))
                    {
                        throw new InvalidDataException("The application package contains an invalid path.");
                    }

                    if (String.IsNullOrEmpty(entry.Name))
                    {
                        Directory.CreateDirectory(destination);
                        continue;
                    }

                    Directory.CreateDirectory(Path.GetDirectoryName(destination));
                    entry.ExtractToFile(destination, true);
                }
            }
        }

        File.WriteAllText(Path.Combine(staging, ".ready"), Version);
        if (Directory.Exists(root)) Directory.Delete(root, true);
        Directory.CreateDirectory(Path.GetDirectoryName(root));
        Directory.Move(staging, root);
    }

    private static string QuoteArguments(string[] args)
    {
        if (args == null || args.Length == 0) return "";
        string result = "";
        for (int index = 0; index < args.Length; index++)
        {
            if (index > 0) result += " ";
            result += "\"" + args[index].Replace("\"", "\\\"") + "\"";
        }
        return result;
    }

    private static void ShowError(string message)
    {
        MessageBox.Show(message, "Loopframe", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
