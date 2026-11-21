import SwiftUI

/// UI language. English is the default; Arabic switches the layout to right-to-left.
enum AppLang: String, CaseIterable, Identifiable {
    case en, ar
    var id: String { rawValue }
    var title: String { self == .en ? "English" : "العربية" }
}

let appLanguageKey = "appLanguage"

var appLang: AppLang { AppLang(rawValue: UserDefaults.standard.string(forKey: appLanguageKey) ?? "en") ?? .en }
var appLocale: Locale { Locale(identifier: appLang == .ar ? "ar" : "en_GB") }
var appLayoutDirection: LayoutDirection { appLang == .ar ? .rightToLeft : .leftToRight }

/// Pick the string for the current UI language.
func t(_ en: String, _ ar: String) -> String { appLang == .ar ? ar : en }

/// Pick a server-provided text: English variant when available, Arabic otherwise.
func pick(_ en: String?, _ ar: String?) -> String {
    appLang == .ar ? (ar ?? en ?? "") : ((en?.isEmpty == false ? en : nil) ?? ar ?? "")
}

/// English / العربية switch used on the sign-in screen and in Plan settings.
struct LanguagePicker: View {
    @AppStorage(appLanguageKey) private var lang = "en"
    var body: some View {
        Picker("Language", selection: Binding(get: { lang }, set: { v in
            lang = v
            Task { _ = try? await APIClient.shared.updateProfile(["language": v]) }
        })) {
            ForEach(AppLang.allCases) { Text($0.title).tag($0.rawValue) }
        }
        .pickerStyle(.segmented)
    }
}
