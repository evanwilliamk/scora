import AuthenticationServices
import Foundation
import UIKit

@MainActor
class StravaAuthManager: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = StravaAuthManager()

    @Published var isConnected: Bool = false
    @Published var isLoading: Bool = false
    @Published var error: String?

    private let clientID = "228067"
    private let edgeFunctionURL = "https://ukrrhqjphkavwnfgekeu.supabase.co/functions/v1/strava-oauth"
    private let redirectURI = "scora://strava-callback"
    private let userIDKey = "scora_user_id"

    var userID: String? {
        UserDefaults.standard.string(forKey: userIDKey)
    }

    override init() {
        super.init()
        isConnected = UserDefaults.standard.string(forKey: userIDKey) != nil
    }

    func connect() async {
        isLoading = true
        error = nil

        var components = URLComponents(string: "https://www.strava.com/oauth/authorize")!
        components.queryItems = [
            .init(name: "client_id",       value: clientID),
            .init(name: "redirect_uri",    value: redirectURI),
            .init(name: "response_type",   value: "code"),
            .init(name: "approval_prompt", value: "auto"),
            .init(name: "scope",           value: "read,activity:read_all"),
        ]

        guard let authURL = components.url else {
            error = "Failed to build auth URL"
            isLoading = false
            return
        }

        do {
            let callbackURL: URL = try await withCheckedThrowingContinuation { continuation in
                let session = ASWebAuthenticationSession(
                    url: authURL,
                    callbackURLScheme: "scora"
                ) { url, err in
                    if let err {
                        continuation.resume(throwing: err)
                    } else if let url {
                        continuation.resume(returning: url)
                    } else {
                        continuation.resume(throwing: URLError(.badServerResponse))
                    }
                }
                session.presentationContextProvider = self
                session.prefersEphemeralWebBrowserSession = false
                session.start()
            }

            guard
                let urlComponents = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
                let code = urlComponents.queryItems?.first(where: { $0.name == "code" })?.value
            else {
                throw URLError(.badServerResponse)
            }

            try await exchangeCode(code)

        } catch ASWebAuthenticationSessionError.canceledLogin {
            // user tapped Cancel — not an error
        } catch {
            self.error = "Connection failed. Please try again."
        }

        isLoading = false
    }

    private func exchangeCode(_ code: String) async throws {
        var urlComponents = URLComponents(string: edgeFunctionURL)!
        urlComponents.queryItems = [.init(name: "code", value: code)]

        guard let url = urlComponents.url else { throw URLError(.badURL) }

        let (data, response) = try await URLSession.shared.data(from: url)

        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }

        let result = try JSONDecoder().decode(OAuthResult.self, from: data)
        UserDefaults.standard.set(result.user_id, forKey: userIDKey)
        isConnected = true
    }

    func disconnect() {
        UserDefaults.standard.removeObject(forKey: userIDKey)
        isConnected = false
    }

    // MARK: - ASWebAuthenticationPresentationContextProviding

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}

private struct OAuthResult: Decodable {
    let user_id: String
}
