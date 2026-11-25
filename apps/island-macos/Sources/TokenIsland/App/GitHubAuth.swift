import AppKit
import Foundation

// MARK: - GitHub OAuth Device Flow Coordinator (`RFC 8628`)
//
// Drives one-click "Sign in with GitHub" inside Preferences:
//  1. POST /api/v1/auth/github/start -> receives `userCode` + `verificationUri`
//  2. Copies `userCode` to clipboard & opens GitHub verification page in browser
//  3. Polls POST /api/v1/auth/github/poll until approved -> stores per-device
//     `ti_dev_...` token in macOS Keychain and syncs profile visibility.

@MainActor
final class GitHubAuthCoordinator: ObservableObject {

    enum State: Equatable {
        case signedOut
        case starting
        case awaitingBrowser(userCode: String, verificationURL: String)
        case signedIn(username: String, displayName: String, visibility: String, githubConnected: Bool)
        case failed(String)
    }

    @Published private(set) var state: State = .signedOut
    @Published private(set) var isUpdatingSettings = false

    private var pollTask: Task<Void, Never>?

    deinit {
        pollTask?.cancel()
    }

    func bootstrap(serverURL: String, username: String, configPath: String) {
        guard let apiKey = KeychainStore.readAPIKey(fallbackConfigPath: configPath),
              !apiKey.isEmpty else {
            state = .signedOut
            return
        }
        if !username.isEmpty {
            state = .signedIn(
                username: username,
                displayName: username,
                visibility: "public",
                githubConnected: apiKey.hasPrefix("ti_dev_")
            )
        }
        guard let resolved = ServerEndpointResolver.resolve(rawURL: serverURL, explicitUsername: username) else {
            return
        }
        Task { [weak self] in
            await self?.refreshMe(baseURL: resolved.baseString, apiKey: apiKey)
        }
    }

    func startGitHubLogin(
        rawServerURL: String,
        onAuthenticated: @escaping (_ baseURL: String, _ username: String, _ visibility: String) -> Void
    ) {
        pollTask?.cancel()

        guard let resolved = ServerEndpointResolver.resolve(rawURL: rawServerURL, explicitUsername: "") else {
            state = .failed("Enter a valid Cloud Server URL above before signing in")
            return
        }

        state = .starting
        let baseURL = resolved.baseString
        let device = DeviceIdentityStore.loadOrCreate()

        pollTask = Task { [weak self] in
            guard let self else { return }
            do {
                guard let configURL = URL(string: "\(baseURL)/api/v1/auth/github/config") else {
                    throw AuthError("Invalid Cloud Server URL")
                }
                var configReq = URLRequest(url: configURL)
                configReq.httpMethod = "GET"
                configReq.timeoutInterval = 10

                let (configData, configResp) = try await URLSession.shared.data(for: configReq)
                let configCode = (configResp as? HTTPURLResponse)?.statusCode ?? 0
                let configObj = (try? JSONSerialization.jsonObject(with: configData) as? [String: Any]) ?? [:]

                if configCode == 200,
                   let clientId = configObj["clientId"] as? String,
                   !clientId.isEmpty {
                    try await self.runDirectDeviceFlow(
                        baseURL: baseURL,
                        clientId: clientId,
                        device: device,
                        onAuthenticated: onAuthenticated
                    )
                    return
                }

                if configCode != 404 {
                    let message = Self.extractErrorMessage(from: configObj, fallback: "HTTP \(configCode)")
                    throw AuthError(message)
                }

                try await self.runLegacyServerProxiedFlow(
                    baseURL: baseURL,
                    device: device,
                    onAuthenticated: onAuthenticated
                )
            } catch is CancellationError {
                return
            } catch let authErr as AuthError {
                self.state = .failed(authErr.message)
            } catch {
                self.state = .failed(error.localizedDescription)
            }
        }
    }

    private func runDirectDeviceFlow(
        baseURL: String,
        clientId: String,
        device: LocalDeviceIdentity,
        onAuthenticated: @escaping (_ baseURL: String, _ username: String, _ visibility: String) -> Void
    ) async throws {
        guard let deviceCodeURL = URL(string: "https://github.com/login/device/code") else {
            throw AuthError("Invalid GitHub device code URL")
        }
        var codeReq = URLRequest(url: deviceCodeURL)
        codeReq.httpMethod = "POST"
        codeReq.timeoutInterval = 12
        codeReq.setValue("application/json", forHTTPHeaderField: "Accept")
        codeReq.setValue("application/json", forHTTPHeaderField: "Content-Type")
        codeReq.setValue("Token-Island-macOS", forHTTPHeaderField: "User-Agent")
        codeReq.httpBody = try JSONSerialization.data(withJSONObject: [
            "client_id": clientId,
            "scope": "read:user",
        ])

        let (codeData, codeResp) = try await URLSession.shared.data(for: codeReq)
        let codeStatus = (codeResp as? HTTPURLResponse)?.statusCode ?? 0
        let codeObj = (try? JSONSerialization.jsonObject(with: codeData) as? [String: Any]) ?? [:]

        guard codeStatus == 200,
              let deviceCode = codeObj["device_code"] as? String,
              let userCode = codeObj["user_code"] as? String,
              let verificationURI = codeObj["verification_uri"] as? String else {
            let detail = (codeObj["error_description"] as? String)
                ?? (codeObj["error"] as? String)
                ?? "HTTP \(codeStatus)"
            throw AuthError("GitHub rejected device code request: \(detail)")
        }

        let expiresIn = (codeObj["expires_in"] as? Int) ?? 900
        var intervalSec = max(5, (codeObj["interval"] as? Int) ?? 5)

        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(userCode, forType: .string)
        let openTarget = (codeObj["verification_uri_complete"] as? String) ?? verificationURI
        if let browserURL = URL(string: openTarget) {
            NSWorkspace.shared.open(browserURL)
        }

        self.state = .awaitingBrowser(userCode: userCode, verificationURL: verificationURI)

        guard let tokenURL = URL(string: "https://github.com/login/oauth/access_token"),
              let exchangeURL = URL(string: "\(baseURL)/api/v1/auth/github/exchange") else {
            throw AuthError("Invalid GitHub OAuth URL")
        }

        let deadline = Date().addingTimeInterval(TimeInterval(expiresIn))
        while !Task.isCancelled && Date() < deadline {
            try await Task.sleep(nanoseconds: UInt64(intervalSec) * 1_000_000_000)
            guard !Task.isCancelled else { return }

            var tokenReq = URLRequest(url: tokenURL)
            tokenReq.httpMethod = "POST"
            tokenReq.timeoutInterval = 12
            tokenReq.setValue("application/json", forHTTPHeaderField: "Accept")
            tokenReq.setValue("application/json", forHTTPHeaderField: "Content-Type")
            tokenReq.setValue("Token-Island-macOS", forHTTPHeaderField: "User-Agent")
            tokenReq.httpBody = try JSONSerialization.data(withJSONObject: [
                "client_id": clientId,
                "device_code": deviceCode,
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            ])

            let (tokenData, tokenResp) = try await URLSession.shared.data(for: tokenReq)
            let tokenStatus = (tokenResp as? HTTPURLResponse)?.statusCode ?? 0
            let tokenObj = (try? JSONSerialization.jsonObject(with: tokenData) as? [String: Any]) ?? [:]

            if tokenStatus == 429 {
                intervalSec += 5
                continue
            }

            if let oauthError = tokenObj["error"] as? String, !oauthError.isEmpty {
                if oauthError == "authorization_pending" {
                    continue
                }
                if oauthError == "slow_down" {
                    if let updated = tokenObj["interval"] as? Int, updated > 0 {
                        intervalSec = updated
                    } else {
                        intervalSec += 5
                    }
                    continue
                }
                let desc = (tokenObj["error_description"] as? String) ?? oauthError
                throw AuthError(desc)
            }

            if let accessToken = tokenObj["access_token"] as? String, !accessToken.isEmpty {
                var exReq = URLRequest(url: exchangeURL)
                exReq.httpMethod = "POST"
                exReq.timeoutInterval = 12
                exReq.setValue("application/json", forHTTPHeaderField: "Content-Type")
                exReq.httpBody = try JSONSerialization.data(withJSONObject: [
                    "githubAccessToken": accessToken,
                    "deviceId": device.deviceId,
                    "deviceName": device.deviceName,
                    "platform": device.platform,
                ])

                let (exData, exResp) = try await URLSession.shared.data(for: exReq)
                let exCode = (exResp as? HTTPURLResponse)?.statusCode ?? 0
                let exObj = (try? JSONSerialization.jsonObject(with: exData) as? [String: Any]) ?? [:]

                guard exCode == 200,
                      let apiKey = exObj["apiKey"] as? String,
                      let username = exObj["username"] as? String else {
                    let msg = Self.extractErrorMessage(from: exObj, fallback: "HTTP \(exCode)")
                    throw AuthError(msg)
                }

                let displayName = (exObj["displayName"] as? String) ?? username
                let visibility = (exObj["visibility"] as? String) ?? "public"

                _ = KeychainStore.saveAPIKey(apiKey)
                self.state = .signedIn(
                    username: username,
                    displayName: displayName,
                    visibility: visibility,
                    githubConnected: true
                )
                onAuthenticated(baseURL, username, visibility)
                return
            }
        }

        if !Task.isCancelled {
            self.state = .failed("GitHub verification code expired — click Sign in to try again")
        }
    }

    private func runLegacyServerProxiedFlow(
        baseURL: String,
        device: LocalDeviceIdentity,
        onAuthenticated: @escaping (_ baseURL: String, _ username: String, _ visibility: String) -> Void
    ) async throws {
        guard let startURL = URL(string: "\(baseURL)/api/v1/auth/github/start") else {
            throw AuthError("Invalid Cloud Server URL")
        }
        var startReq = URLRequest(url: startURL)
        startReq.httpMethod = "POST"
        startReq.timeoutInterval = 10
        startReq.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let startPayload: [String: String] = [
            "deviceId": device.deviceId,
            "deviceName": device.deviceName,
            "platform": device.platform,
        ]
        startReq.httpBody = try JSONSerialization.data(withJSONObject: startPayload)

        let (startData, startResp) = try await URLSession.shared.data(for: startReq)
        let startCode = (startResp as? HTTPURLResponse)?.statusCode ?? 0
        let startObj = (try? JSONSerialization.jsonObject(with: startData) as? [String: Any]) ?? [:]

        guard startCode == 200,
              let sessionId = startObj["sessionId"] as? String,
              let userCode = startObj["userCode"] as? String,
              let verificationURI = startObj["verificationUri"] as? String else {
            let message = Self.extractErrorMessage(from: startObj, fallback: "HTTP \(startCode)")
            throw AuthError(message)
        }

        let expiresIn = (startObj["expiresIn"] as? Int) ?? 900
        var intervalSec = max(2, (startObj["interval"] as? Int) ?? 5)

        // Copy code to clipboard and launch GitHub verification page
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(userCode, forType: .string)
        let openTarget = (startObj["verificationUriComplete"] as? String) ?? verificationURI
        if let browserURL = URL(string: openTarget) {
            NSWorkspace.shared.open(browserURL)
        }

        self.state = .awaitingBrowser(userCode: userCode, verificationURL: verificationURI)

        let deadline = Date().addingTimeInterval(TimeInterval(expiresIn))
        while !Task.isCancelled && Date() < deadline {
            try await Task.sleep(nanoseconds: UInt64(intervalSec) * 1_000_000_000)
            guard !Task.isCancelled else { return }

            guard let pollURL = URL(string: "\(baseURL)/api/v1/auth/github/poll") else {
                throw AuthError("Invalid poll URL")
            }
            var pollReq = URLRequest(url: pollURL)
            pollReq.httpMethod = "POST"
            pollReq.timeoutInterval = 12
            pollReq.setValue("application/json", forHTTPHeaderField: "Content-Type")
            pollReq.httpBody = try JSONSerialization.data(withJSONObject: ["sessionId": sessionId])

            let (pollData, pollResp) = try await URLSession.shared.data(for: pollReq)
            let pollCode = (pollResp as? HTTPURLResponse)?.statusCode ?? 0
            let pollObj = (try? JSONSerialization.jsonObject(with: pollData) as? [String: Any]) ?? [:]

            guard pollCode == 200 else {
                let msg = Self.extractErrorMessage(from: pollObj, fallback: "HTTP \(pollCode)")
                throw AuthError(msg)
            }

            let status = (pollObj["status"] as? String) ?? ""
            if status == "pending" {
                if let updatedInterval = pollObj["interval"] as? Int, updatedInterval > 0 {
                    intervalSec = updatedInterval
                }
                continue
            }

            if status == "complete",
               let apiKey = pollObj["apiKey"] as? String,
               let username = pollObj["username"] as? String {
                let displayName = (pollObj["displayName"] as? String) ?? username
                let visibility = (pollObj["visibility"] as? String) ?? "public"

                _ = KeychainStore.saveAPIKey(apiKey)
                self.state = .signedIn(
                    username: username,
                    displayName: displayName,
                    visibility: visibility,
                    githubConnected: true
                )
                onAuthenticated(baseURL, username, visibility)
                return
            }
        }

        if !Task.isCancelled {
            self.state = .failed("GitHub verification code expired — click Sign in to try again")
        }
    }

    func copyAndReopenBrowser(userCode: String, verificationURL: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(userCode, forType: .string)
        if let url = URL(string: verificationURL) {
            NSWorkspace.shared.open(url)
        }
    }

    func cancelFlow() {
        pollTask?.cancel()
        pollTask = nil
        state = .signedOut
    }

    func signOut(configPath: String, onSignedOut: () -> Void) {
        pollTask?.cancel()
        pollTask = nil
        KeychainStore.deleteAPIKey()
        ConfigWriter.clearCloudAuth(configPath: configPath)
        state = .signedOut
        onSignedOut()
    }

    func updateVisibility(
        _ newVisibility: String,
        rawServerURL: String,
        configPath: String,
        onUpdated: @escaping (String) -> Void
    ) {
        guard let resolved = ServerEndpointResolver.resolve(rawURL: rawServerURL, explicitUsername: ""),
              let apiKey = KeychainStore.readAPIKey(fallbackConfigPath: configPath),
              let url = URL(string: "\(resolved.baseString)/api/v1/me/settings") else {
            return
        }

        isUpdatingSettings = true
        Task { [weak self] in
            defer { self?.isUpdatingSettings = false }
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.timeoutInterval = 8
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
            req.httpBody = try? JSONSerialization.data(withJSONObject: ["visibility": newVisibility])

            do {
                let (data, resp) = try await URLSession.shared.data(for: req)
                guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                    return
                }
                let obj = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
                let vis = (obj["visibility"] as? String) ?? newVisibility
                if case .signedIn(let user, let display, _, let gh) = self?.state {
                    self?.state = .signedIn(username: user, displayName: display, visibility: vis, githubConnected: gh)
                }
                onUpdated(vis)
            } catch {
                Logger.error("failed to update visibility: \(error.localizedDescription)")
            }
        }
    }

    private func refreshMe(baseURL: String, apiKey: String) async {
        guard let url = URL(string: "\(baseURL)/api/v1/me") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.timeoutInterval = 5
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else { return }
            guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let username = obj["username"] as? String else { return }
            let displayName = (obj["displayName"] as? String) ?? username
            let visibility = (obj["visibility"] as? String) ?? "public"
            let githubConnected = (obj["githubConnected"] as? Bool) ?? apiKey.hasPrefix("ti_dev_")
            state = .signedIn(
                username: username,
                displayName: displayName,
                visibility: visibility,
                githubConnected: githubConnected
            )
        } catch {
            // Keep optimistic signed-in state when offline.
        }
    }

    private struct AuthError: Error {
        let message: String
        init(_ message: String) { self.message = message }
    }

    private static func extractErrorMessage(from obj: [String: Any], fallback: String) -> String {
        if let err = obj["error"] as? [String: Any], let msg = err["message"] as? String, !msg.isEmpty {
            return msg
        }
        if let msg = obj["message"] as? String, !msg.isEmpty {
            return msg
        }
        return fallback
    }
}
