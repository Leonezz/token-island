import Foundation
import Security

// MARK: - macOS Keychain Credential Store & Per-Device Identity
//
// Stores per-device Cloud tokens (`ti_dev_...`) in the user's login Keychain so
// `TokenIsland.app` never needs to write plaintext credentials to disk, and
// manages `~/.token-island/device.json` so both Swift and the bundled Node
// collector report the exact same `deviceId` for multi-Mac additive sync.

enum KeychainStore {
    static let service = "com.token-island.cloud"
    static let account = "device-api-key"

    @discardableResult
    static func saveAPIKey(_ apiKey: String) -> Bool {
        let trimmed = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let data = trimmed.data(using: .utf8) else { return false }

        let baseQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]

        SecItemDelete(baseQuery as CFDictionary)

        var insert = baseQuery
        insert[kSecValueData as String] = data
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(insert as CFDictionary, nil)
        return status == errSecSuccess
    }

    nonisolated static func readAPIKey(fallbackConfigPath: String? = nil) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess,
           let data = item as? Data,
           let token = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
           !token.isEmpty {
            return token
        }

        // Fallback to config.json if user logged in via CLI (`tokenisland login` / `register`)
        let cfgPath = fallbackConfigPath ?? IslandConfig.expandTilde("~/.token-island/config.json")
        if let rawData = FileManager.default.contents(atPath: cfgPath),
           let root = try? JSONSerialization.jsonObject(with: rawData) as? [String: Any],
           let cloud = root["cloud"] as? [String: Any],
           let fileKey = cloud["apiKey"] as? String {
            let trimmed = fileKey.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { return trimmed }
        }
        return nil
    }

    @discardableResult
    static func deleteAPIKey() -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}

struct LocalDeviceIdentity: Codable {
    var deviceId: String
    var deviceName: String
    var platform: String
}

enum DeviceIdentityStore {
    static var filePath: String {
        if let explicitHome = ProcessInfo.processInfo.environment["TOKEN_ISLAND_HOME"], !explicitHome.isEmpty {
            return NSString(string: explicitHome).expandingTildeInPath + "/device.json"
        }
        return IslandConfig.expandTilde("~/.token-island/device.json")
    }

    static func loadOrCreate() -> LocalDeviceIdentity {
        let path = filePath
        let hostName = Host.current().localizedName ?? ProcessInfo.processInfo.hostName
        #if arch(arm64)
        let archName = "darwin-arm64"
        #else
        let archName = "darwin-x64"
        #endif

        if let data = FileManager.default.contents(atPath: path),
           let decoded = try? JSONDecoder().decode(LocalDeviceIdentity.self, from: data),
           decoded.deviceId.count >= 4 {
            return decoded
        }

        var randomBytes = [UInt8](repeating: 0, count: 8)
        _ = SecRandomCopyBytes(kSecRandomDefault, randomBytes.count, &randomBytes)
        let hex = randomBytes.map { String(format: "%02x", $0) }.joined()
        let created = LocalDeviceIdentity(
            deviceId: "dev_\(hex)",
            deviceName: hostName.isEmpty ? "Mac" : hostName,
            platform: archName
        )

        let url = URL(fileURLWithPath: path)
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        if let encoded = try? JSONEncoder().encode(created) {
            try? encoded.write(to: url, options: .atomic)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path)
        }
        return created
    }
}
