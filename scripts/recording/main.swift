import AVFoundation
import CoreAudio
import Foundation

struct CaptureOptions {
    let mode: String
    let microphoneURL: URL
    let systemURL: URL?
    let metadataURL: URL

    static func parse(_ arguments: [String]) throws -> CaptureOptions {
        func value(after flag: String) -> String? {
            guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1) else {
                return nil
            }
            return arguments[index + 1]
        }
        guard let mic = value(after: "--mic"), let metadata = value(after: "--meta") else {
            throw CaptureFailure("사용법: --mode remote|inperson --mic FILE --system FILE --meta FILE")
        }
        let mode = value(after: "--mode") == "inperson" ? "inperson" : "remote"
        let system = mode == "remote" ? value(after: "--system").map(URL.init(fileURLWithPath:)) : nil
        if mode == "remote" && system == nil {
            throw CaptureFailure("원격 녹음에는 --system 파일이 필요합니다")
        }
        return CaptureOptions(
            mode: mode,
            microphoneURL: URL(fileURLWithPath: mic),
            systemURL: system,
            metadataURL: URL(fileURLWithPath: metadata)
        )
    }
}

struct TrackMetadata: Codable {
    let schemaVersion: Int
    let mode: String
    let startedAt: String
    let stoppedAt: String
    let micOffsetMs: Int
    let systemOffsetMs: Int?
}

func authorizationName(_ status: AVAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "not-determined"
    @unknown default: return "unknown"
    }
}

if CommandLine.arguments.contains("--doctor") {
    let microphone = authorizationName(AVCaptureDevice.authorizationStatus(for: .audio))
    print("native-capture=available")
    print("microphone-permission=\(microphone)")
    print("system-audio-api=available")
    exit(microphone == "denied" || microphone == "restricted" ? 1 : 0)
}

do {
    let options = try CaptureOptions.parse(CommandLine.arguments)
    try FileManager.default.createDirectory(
        at: options.microphoneURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
    )

    let startedAt = Date()
    let microphone = MicrophoneTrack(outputURL: options.microphoneURL)
    let system = options.systemURL.map(SystemOutputTrack.init(outputURL:))
    try microphone.start()
    do {
        try system?.start()
    } catch {
        microphone.stop()
        throw error
    }

    print("capture-ready mode=\(options.mode)")
    fflush(stdout)

    let stopped = DispatchSemaphore(value: 0)
    signal(SIGINT, SIG_IGN)
    signal(SIGTERM, SIG_IGN)
    let interrupt = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
    let terminate = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    interrupt.setEventHandler { stopped.signal() }
    terminate.setEventHandler { stopped.signal() }
    interrupt.resume()
    terminate.resume()
    while stopped.wait(timeout: .now() + 0.25) == .timedOut {
        RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
    }

    system?.stop()
    microphone.stop()
    let samples = [microphone.firstSampleAt, system?.firstSampleAt].compactMap { $0 }
    let base = samples.min() ?? startedAt
    let offset: (Date?) -> Int = { date in
        Int(max(0, (date ?? base).timeIntervalSince(base) * 1_000).rounded())
    }
    let metadata = TrackMetadata(
        schemaVersion: 1,
        mode: options.mode,
        startedAt: ISO8601DateFormatter().string(from: startedAt),
        stoppedAt: ISO8601DateFormatter().string(from: Date()),
        micOffsetMs: offset(microphone.firstSampleAt),
        systemOffsetMs: system.map { offset($0.firstSampleAt) }
    )
    let encoded = try JSONEncoder().encode(metadata)
    try encoded.write(to: options.metadataURL, options: .atomic)
    print("capture-stopped")
} catch {
    FileHandle.standardError.write(Data("capture-error: \(error)\n".utf8))
    exit(1)
}
