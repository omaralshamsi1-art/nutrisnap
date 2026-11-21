import AuthenticationServices
import UIKit

/// WHOOP OAuth runs on the backend (client secret never ships in the app).
/// The app opens the authorize URL; the backend callback redirects to straineat://whoop?status=...
@MainActor
final class WhoopConnector: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = WhoopConnector()
    private var session: ASWebAuthenticationSession?

    func connect() async throws -> Bool {
        let url = try await APIClient.shared.whoopConnectURL()
        return try await withCheckedThrowingContinuation { cont in
            let s = ASWebAuthenticationSession(url: url, callbackURLScheme: "straineat") { callback, error in
                if let error { cont.resume(throwing: error); return }
                let status = callback.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }?
                    .queryItems?.first { $0.name == "status" }?.value
                cont.resume(returning: status == "connected")
            }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = false
            session = s
            s.start()
        }
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
        }
    }
}
