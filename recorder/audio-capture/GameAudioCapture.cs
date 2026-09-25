using System;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

internal static class GameAudioCapture
{
    private const uint AUDCLNT_SHAREMODE_SHARED = 0;
    private const uint AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
    private const uint AUDCLNT_STREAMFLAGS_EVENTCALLBACK = 0x00040000;
    private const uint AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM = 0x80000000;
    private const uint AUDCLNT_BUFFERFLAGS_SILENT = 0x00000002;
    private const uint AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR = 0x00000004;
    private const long REFERENCE_TIME_UNITS_PER_SECOND = 10000000L;

    private const int AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK = 1;
    private const int PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE = 0;
    private const int PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE = 1;

    private const ushort WAVE_FORMAT_PCM = 1;
    private const ushort VT_BLOB = 65;

    private const int SAMPLE_RATE = 48000;
    private const int CHANNELS = 2;
    private const int BITS = 16;
    private const int BLOCK_ALIGN = CHANNELS * BITS / 8;

    private const uint SYNCHRONIZE = 0x00100000;
    private const uint WAIT_OBJECT_0 = 0;
    private const uint WAIT_TIMEOUT = 258;
    private const uint COINIT_MULTITHREADED = 0;

    private const int ACTIVATION_TIMEOUT_MS = 15000;
    private const uint WAIT_POLL_MS = 200;
    private const long DATA_LIMIT_BYTES = 0xFFFFFF00L;
    private const long GAP_THRESHOLD_MS = 5;
    private const long MAX_GAP_SILENCE_FRAMES = SAMPLE_RATE * 10L;

    private const string DEVICE_PROCESS_LOOPBACK = "VAD\\Process_Loopback";

    private static readonly Guid IID_IAudioClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
    private static readonly Guid IID_IAudioCaptureClient = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");

    private static long s_qpcFreq;
    private static volatile bool s_stopRequested;

    [MTAThread]
    private static int Main(string[] args)
    {
        uint pid = 0;
        string outPath = null;
        string stopEventName = null;
        long sessionQpc = 0;
        bool haveSessionQpc = false;
        bool includeTree = true;

        try
        {
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (a == "--pid")
                {
                    pid = uint.Parse(Next(args, ref i), CultureInfo.InvariantCulture);
                }
                else if (a == "--out")
                {
                    outPath = Next(args, ref i);
                }
                else if (a == "--session-qpc")
                {
                    sessionQpc = long.Parse(Next(args, ref i), CultureInfo.InvariantCulture);
                    haveSessionQpc = true;
                }
                else if (a == "--stop-event")
                {
                    stopEventName = Next(args, ref i);
                }
                else if (a == "--exclude-tree")
                {
                    includeTree = false;
                }
                else
                {
                    Console.Error.WriteLine("GAC: unknown argument: " + a);
                    Usage();
                    return 2;
                }
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("GAC: bad arguments: " + ex.Message);
            Usage();
            return 2;
        }

        if (pid == 0 || outPath == null || stopEventName == null)
        {
            Usage();
            return 2;
        }

        Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e)
        {
            e.Cancel = true;
            s_stopRequested = true;
        };

        int coHr = CoInitializeEx(IntPtr.Zero, COINIT_MULTITHREADED);
        if (coHr < 0 && coHr != unchecked((int)0x80010106))
        {
            Console.Error.WriteLine("GAC: CoInitializeEx failed 0x" + coHr.ToString("X8", CultureInfo.InvariantCulture));
            return 3;
        }

        if (!QueryPerformanceFrequency(out s_qpcFreq) || s_qpcFreq <= 0)
        {
            Console.Error.WriteLine("GAC: QueryPerformanceFrequency failed");
            return 3;
        }

        IntPtr stopEvent = CreateEvent(IntPtr.Zero, true, false, stopEventName);
        if (stopEvent == IntPtr.Zero)
        {
            Console.Error.WriteLine("GAC: CreateEvent(stop) failed " + Marshal.GetLastWin32Error().ToString(CultureInfo.InvariantCulture));
            return 3;
        }

        IntPtr sampleEvent = CreateEvent(IntPtr.Zero, false, false, null);
        if (sampleEvent == IntPtr.Zero)
        {
            Console.Error.WriteLine("GAC: CreateEvent(sample) failed " + Marshal.GetLastWin32Error().ToString(CultureInfo.InvariantCulture));
            return 3;
        }

        IntPtr processHandle = OpenProcess(SYNCHRONIZE, false, pid);
        if (processHandle == IntPtr.Zero)
        {
            Console.Error.WriteLine("GAC: OpenProcess(" + pid.ToString(CultureInfo.InvariantCulture) + ") failed " +
                Marshal.GetLastWin32Error().ToString(CultureInfo.InvariantCulture) + " (process watch disabled)");
        }

        IAudioClient client = null;
        try
        {
            client = ActivateProcessLoopback(pid, includeTree);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("GAC: activation failed: 0x" + ex.HResult.ToString("X8", CultureInfo.InvariantCulture) + " " + ex.Message);
            return 3;
        }

        IAudioCaptureClient capture = null;
        WavWriter writer = null;
        CaptureStats stats = null;
        bool started = false;
        int exit = 0;

        try
        {
            string dir = Path.GetDirectoryName(Path.GetFullPath(outPath));
            if (dir != null && dir.Length > 0 && !Directory.Exists(dir))
            {
                Directory.CreateDirectory(dir);
            }

            writer = new WavWriter(outPath, SAMPLE_RATE, CHANNELS, BITS);

            WAVEFORMATEX fmt = new WAVEFORMATEX();
            fmt.wFormatTag = WAVE_FORMAT_PCM;
            fmt.nChannels = (ushort)CHANNELS;
            fmt.nSamplesPerSec = (uint)SAMPLE_RATE;
            fmt.nAvgBytesPerSec = (uint)(SAMPLE_RATE * BLOCK_ALIGN);
            fmt.nBlockAlign = (ushort)BLOCK_ALIGN;
            fmt.wBitsPerSample = (ushort)BITS;
            fmt.cbSize = 0;

            int hr = client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                0,
                0,
                ref fmt,
                IntPtr.Zero);
            CheckHr(hr, "IAudioClient.Initialize");

            uint bufferFrames;
            CheckHr(client.GetBufferSize(out bufferFrames), "IAudioClient.GetBufferSize");

            Guid capIid = IID_IAudioCaptureClient;
            object capObj;
            CheckHr(client.GetService(capIid, out capObj), "IAudioClient.GetService");
            capture = (IAudioCaptureClient)capObj;

            CheckHr(client.SetEventHandle(sampleEvent), "IAudioClient.SetEventHandle");
            CheckHr(client.Start(), "IAudioClient.Start");
            started = true;

            stats = CaptureLoop(capture, writer, sampleEvent, stopEvent, processHandle, bufferFrames, sessionQpc, haveSessionQpc);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("GAC: capture failed: 0x" + ex.HResult.ToString("X8", CultureInfo.InvariantCulture) + " " + ex.Message);
            exit = 4;
        }
        finally
        {
            if (started)
            {
                try { client.Stop(); } catch (Exception) { }
            }
            if (capture != null)
            {
                try { Marshal.ReleaseComObject(capture); } catch (Exception) { }
            }
            if (client != null)
            {
                try { Marshal.ReleaseComObject(client); } catch (Exception) { }
            }
            if (writer != null)
            {
                try
                {
                    writer.FinalizeFile();
                    writer.Dispose();
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("GAC: finalize failed: " + ex.Message);
                    exit = 5;
                }
            }
            if (processHandle != IntPtr.Zero) { CloseHandle(processHandle); }
            if (sampleEvent != IntPtr.Zero) { CloseHandle(sampleEvent); }
            if (stopEvent != IntPtr.Zero) { CloseHandle(stopEvent); }
        }

        long totalFrames = stats != null ? stats.TotalFrames : 0;
        long silenceFrames = stats != null ? stats.SilenceFrames : 0;
        long firstQpc = stats != null ? stats.FirstQpc : 0;
        string reason = stats != null ? stats.Reason : "not-started";
        long dataBytes = writer != null ? writer.DataBytes : 0;

        long session100ns = haveSessionQpc
            ? (long)Math.Round((double)sessionQpc * REFERENCE_TIME_UNITS_PER_SECOND / (double)s_qpcFreq)
            : 0;

        Console.Out.WriteLine(string.Format(CultureInfo.InvariantCulture,
            "GAC: pid={0} sr={1} ch={2} bits={3} qpc-freq={4} session-qpc={5} session-100ns={6}",
            pid, SAMPLE_RATE, CHANNELS, BITS, s_qpcFreq, haveSessionQpc ? sessionQpc : 0, session100ns));
        Console.Out.WriteLine(string.Format(CultureInfo.InvariantCulture,
            "GAC: first-100ns={0} pad-frames={1}",
            firstQpc, stats != null ? stats.PadFrames : 0));
        Console.Out.WriteLine(string.Format(CultureInfo.InvariantCulture,
            "GAC: reason={0} total-frames={1} silence-frames={2} data-bytes={3}",
            reason, totalFrames, silenceFrames, dataBytes));
        Console.Out.WriteLine("GAC: wav=" + Path.GetFullPath(outPath));

        return exit;
    }

    private static IAudioClient ActivateProcessLoopback(uint pid, bool includeTree)
    {
        IntPtr blob = IntPtr.Zero;
        IntPtr prop = IntPtr.Zero;
        try
        {
            blob = Marshal.AllocHGlobal(12);
            Marshal.WriteInt32(blob, 0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK);
            Marshal.WriteInt32(blob, 4, unchecked((int)pid));
            Marshal.WriteInt32(blob, 8, includeTree
                ? PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
                : PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE);

            PropVariant propv = new PropVariant();
            propv.vt = VT_BLOB;
            propv.wReserved1 = 0;
            propv.wReserved2 = 0;
            propv.wReserved3 = 0;
            propv.cbSize = 12;
            propv.pBlobData = blob;

            prop = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(PropVariant)));
            Marshal.StructureToPtr(propv, prop, false);

            ActivateHandler handler = new ActivateHandler();
            Guid iid = IID_IAudioClient;
            IActivateAudioInterfaceAsyncOperation operation;
            ActivateAudioInterfaceAsync(DEVICE_PROCESS_LOOPBACK, iid, prop, handler, out operation);

            if (!handler.Done.WaitOne(ACTIVATION_TIMEOUT_MS))
            {
                throw new TimeoutException("ActivateAudioInterfaceAsync timed out");
            }

            if (handler.ActivationHr < 0)
            {
                throw new COMException("ActivateAudioInterfaceAsync activation", handler.ActivationHr);
            }
            if (handler.Client == null)
            {
                throw new InvalidOperationException("activation returned no IAudioClient");
            }
            return handler.Client;
        }
        finally
        {
            if (prop != IntPtr.Zero) { Marshal.FreeHGlobal(prop); }
            if (blob != IntPtr.Zero) { Marshal.FreeHGlobal(blob); }
        }
    }

    private static CaptureStats CaptureLoop(
        IAudioCaptureClient capture,
        WavWriter writer,
        IntPtr sampleEvent,
        IntPtr stopEvent,
        IntPtr processHandle,
        uint bufferFrames,
        long sessionQpc,
        bool haveSessionQpc)
    {
        CaptureStats stats = new CaptureStats();

        int scratchLen = (int)Math.Max((long)bufferFrames * BLOCK_ALIGN, 65536L);
        byte[] scratch = new byte[scratchLen];

        IntPtr[] handles;
        int stopIndex = 1;
        int procIndex;
        if (processHandle != IntPtr.Zero)
        {
            handles = new IntPtr[] { sampleEvent, stopEvent, processHandle };
            procIndex = 2;
        }
        else
        {
            handles = new IntPtr[] { sampleEvent, stopEvent };
            procIndex = -1;
        }

        bool aligned = false;
        bool haveExpected = false;
        long expectedQpc = 0;
        long session100ns = haveSessionQpc
            ? (long)Math.Round((double)sessionQpc * REFERENCE_TIME_UNITS_PER_SECOND / (double)s_qpcFreq)
            : 0;

        while (true)
        {
            if (s_stopRequested) { stats.Reason = "ctrl-c"; break; }
            if (writer.DataBytes >= DATA_LIMIT_BYTES) { stats.Reason = "size-limit"; break; }

            uint w = WaitForMultipleObjects((uint)handles.Length, handles, false, WAIT_POLL_MS);
            if (procIndex >= 0 && w == WAIT_OBJECT_0 + (uint)procIndex) { stats.Reason = "process-exit"; break; }
            if (w == WAIT_OBJECT_0 + (uint)stopIndex) { stats.Reason = "stop-event"; break; }
            if (w != WAIT_OBJECT_0 && w != WAIT_TIMEOUT)
            {
                stats.Reason = "wait-error-" + w.ToString(CultureInfo.InvariantCulture);
                break;
            }

            bool stopDraining = false;
            while (true)
            {
                if (s_stopRequested) { stats.Reason = "ctrl-c"; stopDraining = true; break; }

                uint avail;
                int hr = capture.GetNextPacketSize(out avail);
                if (hr < 0)
                {
                    stats.Reason = "getnext-hr-0x" + hr.ToString("X8", CultureInfo.InvariantCulture);
                    stopDraining = true;
                    break;
                }
                if (avail == 0) { break; }

                IntPtr data;
                uint frames;
                uint flags;
                ulong devicePosition;
                ulong qpcPosition;
                hr = capture.GetBuffer(out data, out frames, out flags, out devicePosition, out qpcPosition);
                if (hr < 0)
                {
                    stats.Reason = "getbuffer-hr-0x" + hr.ToString("X8", CultureInfo.InvariantCulture);
                    stopDraining = true;
                    break;
                }

                uint originalFrames = frames;
                if (originalFrames == 0)
                {
                    capture.ReleaseBuffer(0);
                    continue;
                }
                long qpc = (flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR) != 0 ? 0 : unchecked((long)qpcPosition);

                if (!aligned && qpc != 0)
                {
                    aligned = true;
                    stats.HaveFirst = true;
                    stats.FirstQpc = qpc;

                    if (haveSessionQpc)
                    {
                        long delta = unchecked(qpc - session100ns);
                        long pad = (long)Math.Round((double)delta * SAMPLE_RATE / (double)REFERENCE_TIME_UNITS_PER_SECOND);
                        if (pad > MAX_GAP_SILENCE_FRAMES) { pad = MAX_GAP_SILENCE_FRAMES; }
                        stats.PadFrames = pad;
                        if (pad > 0)
                        {
                            writer.WriteSilenceFrames(pad);
                            stats.SilenceFrames += pad;
                        }
                        else if (pad < 0)
                        {
                            long trim = -pad;
                            if (trim >= frames)
                            {
                                frames = 0;
                            }
                            else
                            {
                                data = new IntPtr(data.ToInt64() + trim * BLOCK_ALIGN);
                                frames -= (uint)trim;
                            }
                        }
                    }
                }
                else if (qpc != 0 && haveExpected)
                {
                    long threshold = GAP_THRESHOLD_MS * (REFERENCE_TIME_UNITS_PER_SECOND / 1000);
                    long gapTicks = unchecked(qpc - expectedQpc);
                    if (gapTicks > threshold)
                    {
                        long gapFrames = (long)Math.Round((double)gapTicks * SAMPLE_RATE / (double)REFERENCE_TIME_UNITS_PER_SECOND);
                        if (gapFrames > MAX_GAP_SILENCE_FRAMES) { gapFrames = MAX_GAP_SILENCE_FRAMES; }
                        if (gapFrames > 0)
                        {
                            writer.WriteSilenceFrames(gapFrames);
                            stats.SilenceFrames += gapFrames;
                        }
                    }
                }

                if (frames > 0)
                {
                    long bytes = (long)frames * BLOCK_ALIGN;
                    if (writer.DataBytes + bytes > DATA_LIMIT_BYTES)
                    {
                        capture.ReleaseBuffer(originalFrames);
                        stats.Reason = "size-limit";
                        stopDraining = true;
                        break;
                    }

                    bool silent = (flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0 || data == IntPtr.Zero;
                    if (silent)
                    {
                        writer.WriteSilenceFrames(frames);
                        stats.SilenceFrames += frames;
                    }
                    else
                    {
                        writer.WriteFrames(data, (int)bytes, scratch);
                    }
                    stats.TotalFrames += frames;
                }

                if (qpc != 0)
                {
                    expectedQpc = qpc + (long)Math.Round((double)originalFrames * REFERENCE_TIME_UNITS_PER_SECOND / SAMPLE_RATE);
                    haveExpected = true;
                }

                capture.ReleaseBuffer(originalFrames);
            }

            if (stopDraining) { break; }
        }

        return stats;
    }

    private static string Next(string[] args, ref int i)
    {
        i++;
        if (i >= args.Length) { throw new ArgumentException("missing value after " + args[i - 1]); }
        return args[i];
    }

    private static void CheckHr(int hr, string what)
    {
        if (hr < 0) { throw new COMException(what, hr); }
    }

    private static void Usage()
    {
        Console.Error.WriteLine(
            "Usage: GameAudioCapture --pid <GTA_PID> --out <file.wav> --session-qpc <tick> --stop-event <name> [--exclude-tree]\n" +
            "  Captures the target process tree's rendered audio as 48 kHz stereo PCM16 WAV.\n" +
            "  Silence is inserted so WAV time zero matches --session-qpc (raw QueryPerformanceCounter tick).\n" +
            "  Capture ends when the named stop event is set, the process exits, Ctrl+C, or 4 GB is reached.");
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateEvent(IntPtr eventAttributes, bool manualReset, bool initialState, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool waitAll, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll")]
    private static extern bool QueryPerformanceFrequency(out long frequency);

    [DllImport("ole32.dll")]
    private static extern int CoInitializeEx(IntPtr reserved, uint coInit);

    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
    private static extern void ActivateAudioInterfaceAsync(
        [In, MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
        [In, MarshalAs(UnmanagedType.LPStruct)] Guid riid,
        [In] IntPtr activationParams,
        [In, MarshalAs(UnmanagedType.Interface)] IActivateAudioInterfaceCompletionHandler completionHandler,
        [Out, MarshalAs(UnmanagedType.Interface)] out IActivateAudioInterfaceAsyncOperation activationOperation);
}

[ComVisible(true)]
[ClassInterface(ClassInterfaceType.None)]
internal sealed class ActivateHandler : IActivateAudioInterfaceCompletionHandler, IAgileObject
{
    public readonly ManualResetEvent Done = new ManualResetEvent(false);
    public int ActivationHr = unchecked((int)0x80004005);
    public IAudioClient Client;

    public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation)
    {
        try
        {
            int hr;
            object unk;
            operation.GetActivateResult(out hr, out unk);
            ActivationHr = hr;
            if (hr >= 0 && unk != null)
            {
                Client = (IAudioClient)unk;
            }
        }
        catch (Exception ex)
        {
            ActivationHr = Marshal.GetHRForException(ex);
        }
        finally
        {
            Done.Set();
        }
    }
}

internal sealed class CaptureStats
{
    public string Reason = "unknown";
    public long TotalFrames;
    public long SilenceFrames;
    public long FirstQpc;
    public long PadFrames;
    public bool HaveFirst;
}

[StructLayout(LayoutKind.Sequential, Pack = 1)]
internal struct WAVEFORMATEX
{
    public ushort wFormatTag;
    public ushort nChannels;
    public uint nSamplesPerSec;
    public uint nAvgBytesPerSec;
    public ushort nBlockAlign;
    public ushort wBitsPerSample;
    public ushort cbSize;
}

[StructLayout(LayoutKind.Sequential)]
internal struct PropVariant
{
    public ushort vt;
    public ushort wReserved1;
    public ushort wReserved2;
    public ushort wReserved3;
    public uint cbSize;
    public IntPtr pBlobData;
}

internal sealed class WavWriter : IDisposable
{
    private readonly FileStream _stream;
    private readonly byte[] _zero;
    private long _dataBytes;
    private bool _closed;

    public WavWriter(string path, int sampleRate, int channels, int bits)
    {
        _stream = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.Read, 1 << 16);
        _zero = new byte[channels * (bits / 8) * 4800];
        WriteAscii("RIFF");
        WriteU32(36);
        WriteAscii("WAVE");
        WriteAscii("fmt ");
        WriteU32(16);
        WriteU16(1);
        WriteU16((ushort)channels);
        WriteU32((uint)sampleRate);
        WriteU32((uint)(sampleRate * channels * bits / 8));
        WriteU16((ushort)(channels * bits / 8));
        WriteU16((ushort)bits);
        WriteAscii("data");
        WriteU32(0);
    }

    public long DataBytes
    {
        get { return _dataBytes; }
    }

    public void WriteFrames(IntPtr data, int byteCount, byte[] scratch)
    {
        if (byteCount <= 0) { return; }
        byte[] buffer = scratch;
        if (buffer == null || buffer.Length < byteCount) { buffer = new byte[byteCount]; }
        Marshal.Copy(data, buffer, 0, byteCount);
        _stream.Write(buffer, 0, byteCount);
        _dataBytes += byteCount;
    }

    public void WriteSilenceFrames(long frames)
    {
        if (frames <= 0) { return; }
        long bytes = frames * (long)_zero.Length / 4800;
        long remaining = bytes;
        while (remaining > 0)
        {
            int n = (int)Math.Min(remaining, _zero.Length);
            _stream.Write(_zero, 0, n);
            remaining -= n;
        }
        _dataBytes += bytes;
    }

    public void FinalizeFile()
    {
        if (_closed) { return; }
        uint data = _dataBytes > 0xFFFFFFFFL ? 0xFFFFFFFFu : (uint)_dataBytes;
        _stream.Seek(4, SeekOrigin.Begin);
        WriteU32(unchecked(36u + data));
        _stream.Seek(40, SeekOrigin.Begin);
        WriteU32(data);
        _stream.Flush();
    }

    public void Dispose()
    {
        if (_closed) { return; }
        _closed = true;
        _stream.Dispose();
    }

    private void WriteAscii(string value)
    {
        for (int i = 0; i < value.Length; i++) { _stream.WriteByte((byte)value[i]); }
    }

    private void WriteU32(uint value)
    {
        _stream.WriteByte((byte)(value & 0xFF));
        _stream.WriteByte((byte)((value >> 8) & 0xFF));
        _stream.WriteByte((byte)((value >> 16) & 0xFF));
        _stream.WriteByte((byte)((value >> 24) & 0xFF));
    }

    private void WriteU16(ushort value)
    {
        _stream.WriteByte((byte)(value & 0xFF));
        _stream.WriteByte((byte)((value >> 8) & 0xFF));
    }
}

[ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioClient
{
    [PreserveSig]
    int Initialize(uint shareMode, uint streamFlags, long hnsBufferDuration, long hnsPeriodicity, ref WAVEFORMATEX format, IntPtr audioSessionGuid);

    [PreserveSig]
    int GetBufferSize(out uint bufferFrames);

    [PreserveSig]
    int GetStreamLatency(out long latency);

    [PreserveSig]
    int GetCurrentPadding(out uint paddingFrames);

    [PreserveSig]
    int IsFormatSupported(uint shareMode, ref WAVEFORMATEX format, IntPtr closestMatch);

    [PreserveSig]
    int GetMixFormat(out IntPtr format);

    [PreserveSig]
    int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);

    [PreserveSig]
    int Start();

    [PreserveSig]
    int Stop();

    [PreserveSig]
    int Reset();

    [PreserveSig]
    int SetEventHandle(IntPtr eventHandle);

    [PreserveSig]
    int GetService([In, MarshalAs(UnmanagedType.LPStruct)] Guid riid, [Out, MarshalAs(UnmanagedType.IUnknown)] out object service);
}

[ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioCaptureClient
{
    [PreserveSig]
    int GetBuffer(out IntPtr data, out uint numFrames, out uint flags, out ulong devicePosition, out ulong qpcPosition);

    [PreserveSig]
    int ReleaseBuffer(uint numFrames);

    [PreserveSig]
    int GetNextPacketSize(out uint numFramesInNextPacket);
}

[ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IActivateAudioInterfaceAsyncOperation
{
    void GetActivateResult([Out] out int activateResult, [Out, MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
}

[ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IActivateAudioInterfaceCompletionHandler
{
    void ActivateCompleted(IActivateAudioInterfaceAsyncOperation activateOperation);
}

[ComImport, Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAgileObject
{
}
