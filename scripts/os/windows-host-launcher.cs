// Built as a Windows application: neither the supervisor nor its child gets a console.
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

internal static class ChromeOpsHostLauncher
{
    const uint ExtendedStartupInfo = 0x00080000;
    const uint CreateNoWindow = 0x08000000;
    const uint KillOnJobClose = 0x00002000;
    const uint Infinite = 0xffffffff;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct StartupInfo {
        public uint cb; public string reserved, desktop, title;
        public uint x, y, xSize, ySize, xCountChars, yCountChars, fillAttribute, flags;
        public ushort showWindow, reserved2Size; public IntPtr reserved2, stdInput, stdOutput, stdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct StartupInfoEx { public StartupInfo startup; public IntPtr attributes; }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo { public IntPtr process, thread; public uint processId, threadId; }
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimit {
        public long processTime, jobTime; public uint flags;
        public UIntPtr minWorkingSet, maxWorkingSet; public uint activeProcessLimit;
        public UIntPtr affinity; public uint priorityClass, schedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters { public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes; }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimit {
        public BasicLimit basic; public IoCounters io;
        public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimit info, uint length);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes,
        IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment,
        string currentDirectory, ref StartupInfoEx startup, out ProcessInfo info);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool InitializeProcThreadAttributeList(IntPtr attributes, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool UpdateProcThreadAttribute(IntPtr attributes, uint flags, IntPtr attribute,
        IntPtr value, IntPtr size, IntPtr previousValue, IntPtr returnSize);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr attributes);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    static void Check(bool success) { if (!success) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    static string QuotePath(string path) {
        // Executable/file paths cannot contain quotes. A file path must not end in a separator.
        if (path.IndexOf('"') >= 0 || path.EndsWith("\\") || path.EndsWith("/"))
            throw new ArgumentException("Invalid executable or entry-point path");
        return "\"" + path + "\"";
    }
    static int Main(string[] args) {
        IntPtr job = IntPtr.Zero;
        ProcessInfo child = new ProcessInfo();
        IntPtr attributes = IntPtr.Zero, jobValue = IntPtr.Zero;
        bool attributesReady = false;
        try {
            if (args.Length != 3 || !System.Text.RegularExpressions.Regex.IsMatch(args[2], "^--build=[a-f0-9]{64}$"))
                throw new ArgumentException("Expected Node executable, Host entry point, and build identity");
            string command = QuotePath(args[0]) + " " + QuotePath(args[1]) + " " + args[2];
            job = CreateJobObject(IntPtr.Zero, null);
            Check(job != IntPtr.Zero);
            ExtendedLimit limits = new ExtendedLimit();
            limits.basic.flags = KillOnJobClose;
            Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimit))));
            // Windows 10+ can assign the job atomically at process creation. There is no
            // suspended-child gap in which stopping the task could leave an orphan.
            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            Check(size != IntPtr.Zero);
            attributes = Marshal.AllocHGlobal(size);
            Check(InitializeProcThreadAttributeList(attributes, 1, 0, ref size));
            attributesReady = true;
            jobValue = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(jobValue, job);
            Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x0002000d),
                jobValue, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
            StartupInfoEx startup = new StartupInfoEx();
            startup.startup.cb = (uint)Marshal.SizeOf(typeof(StartupInfoEx));
            startup.attributes = attributes;
            Check(CreateProcess(args[0], new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, false,
                ExtendedStartupInfo | CreateNoWindow, IntPtr.Zero, Environment.CurrentDirectory, ref startup, out child));
            Check(WaitForSingleObject(child.process, Infinite) == 0);
            uint exitCode;
            Check(GetExitCodeProcess(child.process, out exitCode));
            if (exitCode != 0) Log("Host exited with code " + exitCode);
            return unchecked((int)exitCode);
        } catch (Exception error) {
            Log(error.ToString());
            return 1;
        } finally {
            if (attributesReady) DeleteProcThreadAttributeList(attributes);
            if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
            if (jobValue != IntPtr.Zero) Marshal.FreeHGlobal(jobValue);
            if (job != IntPtr.Zero) CloseHandle(job);
            if (child.thread != IntPtr.Zero) CloseHandle(child.thread);
            if (child.process != IntPtr.Zero) CloseHandle(child.process);
        }
    }
    static void Log(string message) {
        try {
            string folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ChromeOps");
            Directory.CreateDirectory(folder);
            File.AppendAllText(Path.Combine(folder, "host-launcher.log"), DateTime.UtcNow.ToString("o") + " " + message + Environment.NewLine);
        } catch {
            // Exit failure remains observable through Task Scheduler if the disk cannot be written.
        }
    }
}
