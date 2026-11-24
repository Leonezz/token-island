import Foundation

// MARK: - Formatting
//
// Swift counterparts of packages/core/src/format.ts so the widget shows exactly
// the same strings as the CLI / badges / dashboard. Keep the rounding rules in
// sync with the TypeScript implementation.

enum Fmt {

    /// Removes trailing fractional zeros: "12.40" -> "12.4", "12.00" -> "12".
    private static func trimZero(_ value: String) -> String {
        guard value.contains(".") else { return value }
        var trimmed = value
        while trimmed.hasSuffix("0") { trimmed.removeLast() }
        if trimmed.hasSuffix(".") { trimmed.removeLast() }
        return trimmed
    }

    /// Compact token count for dense UI: 942 / 12.4K / 1.24M / 3.1B.
    static func tokens(_ value: Double) -> String {
        guard value.isFinite else { return "—" }
        let sign = value < 0 ? "-" : ""
        let magnitude = abs(value).rounded()
        if magnitude < 1_000 {
            if value > 0 && value < 1 { return "<1" }
            return sign + String(Int(magnitude))
        }
        let divisor: Double
        let suffix: String
        if magnitude >= 1e12 {
            divisor = 1e12; suffix = "T"
        } else if magnitude >= 1e9 {
            divisor = 1e9; suffix = "B"
        } else if magnitude >= 1e6 {
            divisor = 1e6; suffix = "M"
        } else {
            divisor = 1e3; suffix = "K"
        }
        let scaled = magnitude / divisor
        let decimals: Int
        if scaled < 10 { decimals = 2 } else if scaled < 100 { decimals = 1 } else { decimals = 0 }
        return sign + trimZero(String(format: "%.\(decimals)f", scaled)) + suffix
    }

    static func tokens(_ value: Int) -> String { tokens(Double(value)) }

    /// Full precision with thousands separators: 1,234,567.
    static func tokensFull(_ value: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: "en_US")
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// Estimated cost. `approx` prefixes "~" (used for the widget's hero cost).
    static func cost(_ usd: Double?, approx: Bool = false) -> String {
        let prefix = approx ? "~" : ""
        guard let usd, usd.isFinite else { return "—" }
        let magnitude = abs(usd)
        if magnitude == 0 { return prefix + "$0" }
        if magnitude >= 10_000 { return prefix + "$" + tokens(magnitude) }
        if magnitude >= 100 { return prefix + "$" + String(Int(magnitude.rounded())) }
        if magnitude >= 0.01 { return prefix + "$" + trimZero(String(format: "%.2f", magnitude)) }
        if magnitude >= 0.0001 { return prefix + "<$0.01" }
        return prefix + "<$0.0001"
    }

    /// 0.4213 -> "42%"; 0.004 -> "<1%"; 0 -> "0%".
    static func percent(_ ratio: Double, decimals: Int = 0) -> String {
        guard ratio.isFinite, ratio > 0 else { return "0%" }
        let pct = ratio * 100
        if pct < 1 { return "<1%" }
        let effective = (decimals == 0 && pct < 10) ? 1 : decimals
        return trimZero(String(format: "%.\(effective)f", pct)) + "%"
    }

    /// "time ago" label, kept short for the island.
    static func relative(_ ts: Double?, now: Double) -> String {
        guard let ts, ts > 0 else { return "never" }
        let delta = max(0, now - ts)
        if delta < 15_000 { return "just now" }
        if delta < 60_000 { return "\(Int((delta / 1_000).rounded()))s ago" }
        if delta < 3_600_000 { return "\(Int((delta / 60_000).rounded()))m ago" }
        if delta < 86_400_000 { return "\(Int((delta / 3_600_000).rounded()))h ago" }
        if delta < 7 * 86_400_000 { return "\(Int((delta / 86_400_000).rounded()))d ago" }
        return dateKey(ts)
    }

    /// Ultra-compact relative label for the header: now / 54s / 2m / 1h.
    static func relativeCompact(_ ts: Double?, now: Double) -> String {
        guard let ts, ts > 0 else { return "never" }
        let delta = max(0, now - ts)
        if delta < 15_000 { return "now" }
        if delta < 60_000 { return "\(Int((delta / 1_000).rounded()))s" }
        if delta < 3_600_000 { return "\(Int((delta / 60_000).rounded()))m" }
        if delta < 86_400_000 { return "\(Int((delta / 3_600_000).rounded()))h" }
        return "\(Int((delta / 86_400_000).rounded()))d"
    }

    /// HH:MM in the host's local time.
    static func clock(_ ts: Double) -> String {
        let date = Date(timeIntervalSince1970: ts / 1_000)
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.string(from: date)
    }

    /// Clips a label with an ellipsis.
    static func truncate(_ value: String, _ maxLength: Int) -> String {
        guard value.count > maxLength else { return value }
        guard maxLength > 1 else { return String(value.prefix(maxLength)) }
        return String(value.prefix(maxLength - 1)) + "…"
    }

    private static func dateKey(_ ts: Double) -> String {
        let date = Date(timeIntervalSince1970: ts / 1_000)
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.string(from: date)
    }

    // MARK: Project labels

    /// Formats a live-session project label for the Silkscreen bitmap font.
    ///
    /// ASCII labels are kept as-is (uppercased at draw time); labels that
    /// contain non-ASCII characters (e.g. a Chinese Codex workspace name) are
    /// romanised with Foundation so they never render as `??`:
    /// `存根` -> `CUN GEN`. The JSON model is never modified — this is a
    /// presentation-only transform. Empty / punctuation-only results fall back
    /// to `SESSION` so the row never goes blank.
    static func projectLabel(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "SESSION" }

        let value: String
        if trimmed.allSatisfy({ $0.isASCII }) {
            // ASCII labels are untouched (uppercasing happens on every pixel
            // surface anyway).
            value = trimmed.uppercased()
        } else {
            let romanised = trimmed
                .applyingTransform(.toLatin, reverse: false)?
                .applyingTransform(.stripDiacritics, reverse: false) ?? trimmed
            // Drop any characters the bitmap font cannot draw, collapse the
            // whitespace the transliteration inserts between words.
            var ascii = ""
            for scalar in romanised.unicodeScalars {
                if scalar.isASCII {
                    ascii.unicodeScalars.append(scalar)
                } else {
                    ascii.append(" ")
                }
            }
            ascii = ascii
                .split(whereSeparator: { $0.isWhitespace })
                .joined(separator: " ")
            value = ascii.trimmingCharacters(in: .whitespaces).uppercased()
        }

        let hasLegibleCharacter = value.contains { $0.isLetter || $0.isNumber }
        return hasLegibleCharacter ? value : "SESSION"
    }

    /// Natural-case project label for crisp system font rendering (supports Unicode & CJK).
    static func cleanProjectLabel(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "session" : trimmed
    }

    /// Share of a total, safe for zero totals.
    static func share(part: Int, total: Int) -> Double {
        guard total > 0 else { return 0 }
        return min(1, max(0, Double(part) / Double(total)))
    }
}
