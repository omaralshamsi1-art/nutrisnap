import AVFoundation
import Foundation
import Speech

/// Arabic dictation for describing a meal (on-device when available).
@MainActor @Observable
final class SpeechInput {
    var isRecording = false
    var error: String?

    private let recognizer = appLang == .ar
        ? SFSpeechRecognizer(locale: Locale(identifier: "ar-AE")) ?? SFSpeechRecognizer(locale: Locale(identifier: "ar-SA"))
        : SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    func start(onText: @escaping (String) -> Void) async {
        error = nil
        let speechOK = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
            SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0 == .authorized) }
        }
        let micOK = await AVAudioApplication.requestRecordPermission()
        guard speechOK, micOK else { error = t("Allow the microphone and speech recognition in Settings", "اسمح بالميكروفون والتعرّف على الكلام من الإعدادات"); return }
        guard let recognizer, recognizer.isAvailable else { error = t("Speech recognition isn't available right now", "التعرّف على الكلام غير متاح الآن"); return }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
            request = req

            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in req.append(buffer) }
            engine.prepare()
            try engine.start()
            isRecording = true

            task = recognizer.recognitionTask(with: req) { [weak self] result, err in
                let text = result?.bestTranscription.formattedString
                let final = result?.isFinal ?? false
                Task { @MainActor in
                    if let text { onText(text) }
                    if err != nil || final { self?.stop() }
                }
            }
        } catch {
            self.error = t("Couldn't start the microphone", "تعذّر تشغيل الميكروفون")
            stop()
        }
    }

    func stop() {
        guard isRecording || task != nil else { return }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.finish()
        task = nil
        request = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
