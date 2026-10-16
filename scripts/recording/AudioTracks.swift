import AVFoundation
import CoreAudio
import Foundation

protocol MeetingAudioTrack: AnyObject {
    var firstSampleAt: Date? { get }
    func stop()
}

final class MicrophoneTrack: MeetingAudioTrack, @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let outputURL: URL
    private let lock = NSLock()
    private var output: AVAudioFile?
    private var live: LivePCMWriter?
    private(set) var firstSampleAt: Date?

    init(outputURL: URL) {
        self.outputURL = outputURL
    }

    func start() throws {
        let input = engine.inputNode
        let sourceFormat = input.outputFormat(forBus: 0)
        guard sourceFormat.sampleRate > 0,
              let mono = AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: sourceFormat.sampleRate,
                channels: 1,
                interleaved: false
              ),
              let converter = AVAudioConverter(from: sourceFormat, to: mono)
        else {
            throw CaptureFailure("마이크 오디오 형식을 열 수 없습니다")
        }
        output = try makeAACFile(at: outputURL, format: mono)
        live = LivePCMWriter(next: outputURL, sourceRate: mono.sampleRate)
        input.installTap(onBus: 0, bufferSize: 4096, format: sourceFormat) {
            [weak self] buffer, _ in
            guard let self else { return }
            self.markFirstSample()
            let ratio = mono.sampleRate / sourceFormat.sampleRate
            let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio + 1)
            guard let converted = AVAudioPCMBuffer(pcmFormat: mono, frameCapacity: capacity) else {
                return
            }
            var supplied = false
            var conversionError: NSError?
            converter.convert(to: converted, error: &conversionError) { _, status in
                if supplied {
                    status.pointee = .noDataNow
                    return nil
                }
                supplied = true
                status.pointee = .haveData
                return buffer
            }
            guard conversionError == nil else { return }
            try? self.output?.write(from: converted)
            self.live?.append(converted)
        }
        engine.prepare()
        try engine.start()
    }

    func stop() {
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        output = nil
        live?.close()
        live = nil
    }

    private func markFirstSample() {
        lock.lock()
        if firstSampleAt == nil { firstSampleAt = Date() }
        lock.unlock()
    }
}

final class SystemOutputTrack: MeetingAudioTrack, @unchecked Sendable {
    private let outputURL: URL
    private let callbackQueue = DispatchQueue(label: "dashboard.meeting.system-audio")
    private let lock = NSLock()
    private var tap = AudioObjectID(kAudioObjectUnknown)
    private var device = AudioObjectID(kAudioObjectUnknown)
    private var callback: AudioDeviceIOProcID?
    private var output: AVAudioFile?
    private var live: LivePCMWriter?
    private(set) var firstSampleAt: Date?

    init(outputURL: URL) {
        self.outputURL = outputURL
    }

    func start() throws {
        let tapConfiguration = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
        tapConfiguration.name = "Dashboard meeting system audio"
        tapConfiguration.isPrivate = true
        tapConfiguration.muteBehavior = .unmuted

        try check(AudioHardwareCreateProcessTap(tapConfiguration, &tap), "시스템 오디오 탭 생성")
        do {
            let format = try readTapFormat()
            try createPrivateDevice(for: tapConfiguration.uuid)
            output = try makeAACFile(at: outputURL, format: format)
            live = LivePCMWriter(next: outputURL, sourceRate: format.sampleRate)
            try attachCallback(format: format)
        } catch {
            stop()
            throw error
        }
    }

    func stop() {
        if let callback, device != kAudioObjectUnknown {
            AudioDeviceStop(device, callback)
            AudioDeviceDestroyIOProcID(device, callback)
        }
        callback = nil
        if device != kAudioObjectUnknown {
            AudioHardwareDestroyAggregateDevice(device)
            device = AudioObjectID(kAudioObjectUnknown)
        }
        if tap != kAudioObjectUnknown {
            AudioHardwareDestroyProcessTap(tap)
            tap = AudioObjectID(kAudioObjectUnknown)
        }
        output = nil
        callbackQueue.sync {
            live?.close()
            live = nil
        }
    }

    private func readTapFormat() throws -> AVAudioFormat {
        var property = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var description = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        try check(
            AudioObjectGetPropertyData(tap, &property, 0, nil, &size, &description),
            "시스템 오디오 형식 읽기"
        )
        guard let format = AVAudioFormat(streamDescription: &description) else {
            throw CaptureFailure("시스템 오디오 형식을 사용할 수 없습니다")
        }
        return format
    }

    private func createPrivateDevice(for tapUUID: UUID) throws {
        let configuration: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Dashboard meeting capture",
            kAudioAggregateDeviceUIDKey: "dashboard.meeting.\(UUID().uuidString)",
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [] as [[String: Any]],
            kAudioAggregateDeviceTapListKey: [[
                kAudioSubTapUIDKey: tapUUID.uuidString,
                kAudioSubTapDriftCompensationKey: true,
            ]],
        ]
        try check(
            AudioHardwareCreateAggregateDevice(configuration as CFDictionary, &device),
            "시스템 오디오용 임시 장치 생성"
        )
    }

    private func attachCallback(format: AVAudioFormat) throws {
        var status = AudioDeviceCreateIOProcIDWithBlock(
            &callback,
            device,
            callbackQueue
        ) { [weak self] _, buffers, _, _, _ in
            guard let self,
                  let pcm = AVAudioPCMBuffer(
                    pcmFormat: format,
                    bufferListNoCopy: buffers,
                    deallocator: nil
                  )
            else { return }
            self.lock.lock()
            if self.firstSampleAt == nil { self.firstSampleAt = Date() }
            self.lock.unlock()
            try? self.output?.write(from: pcm)
            self.live?.append(pcm)
        }
        try check(status, "시스템 오디오 콜백 연결")
        guard let callback else {
            throw CaptureFailure("시스템 오디오 콜백이 생성되지 않았습니다")
        }
        status = AudioDeviceStart(device, callback)
        try check(status, "시스템 오디오 녹음 시작")
    }
}

/// Live side file: 16 kHz-ish mono s16le appended as audio arrives.
/// The AAC .caf has no packet table until it closes, so nothing can read it
/// mid-meeting. The dashboard reads this file every minute for the live
/// summary. Name: live-<track>.pcm next to the .caf, rate in live-<track>.json.
final class LivePCMWriter {
    private let handle: FileHandle?
    private let step: Int

    init(next url: URL, sourceRate: Double) {
        let base = url.deletingPathExtension().lastPathComponent
        let dir = url.deletingLastPathComponent()
        let pcm = dir.appendingPathComponent("live-\(base).pcm")
        let rate = Int(sourceRate.rounded())
        step = rate % 16000 == 0 ? max(1, rate / 16000) : 1
        let meta = "{\"sampleRate\":\(rate / step),\"format\":\"s16le\",\"channels\":1}"
        try? meta.write(to: dir.appendingPathComponent("live-\(base).json"), atomically: true, encoding: .utf8)
        FileManager.default.createFile(atPath: pcm.path, contents: nil)
        handle = try? FileHandle(forWritingTo: pcm)
    }

    /// Averages channels and decimates by `step`. Float32 buffers only.
    func append(_ buffer: AVAudioPCMBuffer) {
        guard let handle, let data = buffer.floatChannelData else { return }
        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        let interleaved = buffer.format.isInterleaved
        let stride = buffer.stride
        var out = [Int16]()
        out.reserveCapacity(frames / step + 1)
        var i = 0
        while i < frames {
            var sum: Float = 0
            for c in 0..<channels {
                sum += interleaved ? data[0][i * stride + c] : data[c][i]
            }
            let v = max(-1, min(1, sum / Float(max(1, channels))))
            out.append(Int16(v * 32767))
            i += step
        }
        out.withUnsafeBytes { handle.write(Data($0)) }
    }

    func close() {
        try? handle?.close()
    }
}

struct CaptureFailure: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

private func check(_ status: OSStatus, _ operation: String) throws {
    guard status == noErr else {
        throw CaptureFailure("\(operation) 실패 (OSStatus \(status))")
    }
}

private func makeAACFile(at url: URL, format: AVAudioFormat) throws -> AVAudioFile {
    try AVAudioFile(
        forWriting: url,
        settings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: format.sampleRate,
            AVNumberOfChannelsKey: format.channelCount,
        ],
        commonFormat: format.commonFormat,
        interleaved: format.isInterleaved
    )
}
