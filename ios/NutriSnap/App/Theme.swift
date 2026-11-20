import SwiftUI
import UIKit

/// Same palette as the web app (light + dark).
enum Theme {
    static let bg = dyn(0xF4F2EC, 0x0D1411)
    static let card = dyn(0xFFFFFF, 0x151E19)
    static let card2 = dyn(0xF8F7F3, 0x1B2620)
    static let ink = dyn(0x17201B, 0xEEF3EF)
    static let muted = dyn(0x66706A, 0x9AA69F)
    static let line = dyn(0xE7E3DA, 0x26332C)
    static let brand = dyn(0x0F3D2E, 0x8FD3A8)
    static let brand2 = dyn(0x1F6B4F, 0x8FD3A8)
    static let brandSoft = dyn(0xE4EFE8, 0x1D3127)
    static let accent = dyn(0xE8A33D, 0xF0B04F)
    static let accentSoft = dyn(0xFBF0DC, 0x2E2516)
    static let protein = dyn(0x3B6FD8, 0x7AA2F5)
    static let carbs = dyn(0xE09A2C, 0xF0B04F)
    static let fat = dyn(0xD0567A, 0xEC7FA0)
    static let fiber = dyn(0x2F8F5B, 0x6CC995)
    static let good = dyn(0x1F8A4C, 0x5FD08E)
    static let goodSoft = dyn(0xDEF2E5, 0x163524)
    static let bad = dyn(0xD23B2A, 0xFF7B6B)
    static let badSoft = dyn(0xFDE4E0, 0x3D1B16)
    static let warn = dyn(0xB8741A, 0xF0B04F)
    static let ringTrack = dyn(0xECE8DF, 0x24302A)

    /// Green when within / on the good side of the target, red when over / negative.
    static func status(_ ok: Bool) -> Color { ok ? good : bad }
    static func statusSoft(_ ok: Bool) -> Color { ok ? goodSoft : badSoft }

    private static func dyn(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

// MARK: Building blocks

struct Card<Content: View>: View {
    var title: String? = nil
    var icon: String? = nil
    var trailing: AnyView? = nil
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if title != nil || trailing != nil {
                HStack(spacing: 6) {
                    if let icon { Image(systemName: icon).foregroundStyle(Theme.brand2) }
                    if let title { Text(title).font(.headline).foregroundStyle(Theme.ink) }
                    Spacer()
                    if let trailing { trailing }
                }
            }
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Theme.line.opacity(0.6), lineWidth: 0.5))
        .shadow(color: .black.opacity(0.04), radius: 10, y: 4)
    }
}

struct Chip: View {
    let text: String
    var icon: String? = nil
    var fg: Color = Theme.brand2
    var bg: Color = Theme.brandSoft
    var body: some View {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon) }
            Text(text)
        }
        .font(.caption.weight(.semibold))
        .padding(.horizontal, 10).padding(.vertical, 5)
        .foregroundStyle(fg)
        .background(bg, in: Capsule())
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    var color: Color = Theme.brand
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .foregroundStyle(.white)
            .background(color.opacity(configuration.isPressed ? 0.8 : 1), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct SoftButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
            .foregroundStyle(Theme.brand2)
            .background(Theme.brandSoft.opacity(configuration.isPressed ? 0.7 : 1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct Notice: View {
    let text: String
    var level: String = "info"
    var body: some View {
        let warn = level == "warn" || level == "warning"
        let danger = level == "danger" || level == "error"
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: danger ? "exclamationmark.octagon.fill" : warn ? "exclamationmark.triangle.fill" : "info.circle.fill")
            Text(text).font(.footnote).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(12)
        .foregroundStyle(danger ? Theme.bad : warn ? Theme.warn : Theme.brand2)
        .background(danger ? Theme.badSoft : warn ? Theme.accentSoft : Theme.brandSoft, in: RoundedRectangle(cornerRadius: 14))
    }
}

/// Progress bar for one nutrient against its target.
struct MacroProgress: View {
    let title: String
    let value: Double
    let target: Double?
    let color: Color
    var unit = "غ"
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(title).font(.caption).foregroundStyle(Theme.muted)
                Spacer()
                Text(target.map { "\(fmt(value)) / \(fmt($0)) \(unit)" } ?? "\(fmt(value)) \(unit)")
                    .font(.caption.weight(.semibold)).monospacedDigit().foregroundStyle(Theme.ink)
            }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.ringTrack)
                    Capsule().fill(color)
                        .frame(width: g.size.width * min(1, (target ?? 0) > 0 ? value / target! : 0))
                }
            }
            .frame(height: 7)
        }
    }
}

// MARK: Formatting

func fmt(_ v: Double) -> String { guard v.isFinite else { return "—" }; return Int(v.rounded()).formatted(.number.locale(Locale(identifier: "en_US"))) }
func fmt1(_ v: Double) -> String { v.formatted(.number.precision(.fractionLength(0...1)).locale(Locale(identifier: "en_US"))) }
/// "+1,130" / "−450" — always shown left-to-right so the sign stays in front of the number.
func signed(_ v: Double) -> String {
    guard v.isFinite else { return "—" }
    let n = Int(v.rounded())
    return ltr((n > 0 ? "+" : n < 0 ? "−" : "") + abs(n).formatted(.number.locale(Locale(identifier: "en_US"))))
}
/// Signed kg value ("+0.4 كغ" / "−1.2 كغ"), sign kept in front in Arabic text.
func signedKg(_ v: Double) -> String { ltr((v > 0 ? "+" : v < 0 ? "−" : "") + fmt1(abs(v))) + " كغ" }
/// Left-to-right isolate so signs and ranges are not reordered inside Arabic text.
func ltr(_ s: String) -> String { "\u{2066}" + s + "\u{2069}" }

let arabic = Locale(identifier: "ar")
extension Date {
    var arDayMonth: String { formatted(.dateTime.day().month(.wide).locale(arabic)) }
    var arWeekday: String { formatted(.dateTime.weekday(.wide).locale(arabic)) }
    var arMonthYear: String { formatted(.dateTime.month(.wide).year().locale(arabic)) }
    var arTime: String { formatted(.dateTime.hour().minute().locale(arabic)) }
}

func sourceName(_ s: String) -> String {
    ["apple_health": "Apple Health", "whoop": "WHOOP", "health_connect": "Health Connect",
     "garmin": "Garmin", "fitbit": "Fitbit", "manual": "يدوي", "estimate": "تقدير", "formula": "معادلة",
     "device": "جهازك", "adaptive": "من بياناتك"][s] ?? s
}

func sportIcon(_ kind: String?) -> String {
    switch kind {
    case "run": return "figure.run"
    case "walk": return "figure.walk"
    case "bike": return "figure.outdoor.cycle"
    case "strength": return "dumbbell.fill"
    case "swim": return "figure.pool.swim"
    case "hiit": return "figure.highintensity.intervaltraining"
    case "mind": return "figure.mind.and.body"
    case "racket": return "figure.tennis"
    case "team": return "figure.soccer"
    case "combat": return "figure.boxing"
    default: return "figure.mixed.cardio"
    }
}

extension View {
    func screenBackground() -> some View { background(Theme.bg.ignoresSafeArea()) }
}
