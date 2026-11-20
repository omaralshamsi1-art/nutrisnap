import SwiftUI

@main
struct NutriSnapApp: App {
    @State private var store = AppStore()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(\.layoutDirection, .rightToLeft)
                .environment(\.locale, Locale(identifier: "ar"))
                .tint(Theme.brand2)
                .onChange(of: phase) { _, p in
                    if p == .active, store.signedIn { Task { await store.refresh() } }
                }
                .onReceive(NotificationCenter.default.publisher(for: .nutriSnapUnauthorized)) { _ in
                    store.handleUnauthorized()
                }
        }
    }
}

struct RootView: View {
    @Environment(AppStore.self) private var store
    @State private var tab = 0

    var body: some View {
        @Bindable var store = store
        Group {
            if !store.signedIn {
                AuthView()
            } else {
                TabView(selection: $tab) {
                    TodayView(onLog: { tab = 2 })
                        .tag(0).tabItem { Label("اليوم", systemImage: "sun.max.fill") }
                    ProgressTab()
                        .tag(1).tabItem { Label("التقدم", systemImage: "chart.line.uptrend.xyaxis") }
                    LogView(onLogged: { tab = 0 })
                        .tag(2).tabItem { Label("سجّل وجبة", systemImage: "plus.circle.fill") }
                    PlanTab()
                        .tag(3).tabItem { Label("الخطة", systemImage: "target") }
                }
                .task {
                    try? await HealthKitManager.shared.requestAuthorization()
                    HealthKitManager.shared.enableBackgroundSync()
                    await store.refresh()
                }
                .fullScreenCover(isPresented: $store.needsOnboarding) {
                    OnboardingView().environment(store).environment(\.layoutDirection, .rightToLeft)
                }
            }
        }
    }
}

/// App-wide state: who is signed in and today's numbers.
@MainActor @Observable
final class AppStore {
    var balance: Balance?
    var motivation: Motivation?
    var me: AuthUser?
    var error: String?
    var isLoading = false
    var needsOnboarding = false
    var day = Date()
    var whoopConnected = UserDefaults.standard.bool(forKey: "whoopConnected")
    var signedIn: Bool = AppStore.hasCredentials()

    var isOwner: Bool { me?.role == "owner" }
    var isToday: Bool { Calendar.current.isDateInToday(day) }

    static func hasCredentials() -> Bool {
        let d = UserDefaults.standard
        return !(d.string(forKey: "apiKey") ?? "").isEmpty || !(d.string(forKey: "accessToken") ?? "").isEmpty
    }

    func refresh() async {
        isLoading = true
        defer { isLoading = false }
        await HealthKitManager.shared.syncBurnToServer()
        await HealthKitManager.shared.syncWorkoutsToServer()
        if whoopConnected {
            let lastSync = UserDefaults.standard.double(forKey: "whoopLastSync")
            if Date().timeIntervalSince1970 - lastSync > 15 * 60 { // at most every 15 min
                let from = Calendar.current.date(byAdding: .day, value: -2, to: Date())!
                if (try? await APIClient.shared.whoopSync(from: from, to: Date())) != nil {
                    UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "whoopLastSync")
                }
            }
        }
        do {
            let b = try await APIClient.shared.balance(date: day)
            balance = b
            error = nil
            if b.onboarded == false && isToday { needsOnboarding = true }
        } catch {
            self.error = error.localizedDescription
        }
        if me == nil { me = try? await APIClient.shared.me() }
        if isToday { motivation = try? await APIClient.shared.motivation() }
    }

    func shiftDay(_ d: Int) {
        guard let next = Calendar.current.date(byAdding: .day, value: d, to: day), next <= Date() else { return }
        day = next
        Task { await refresh() }
    }

    func setWhoop(_ on: Bool) {
        whoopConnected = on
        UserDefaults.standard.set(on, forKey: "whoopConnected")
    }

    func signIn(token: String, user: AuthUser) {
        let d = UserDefaults.standard
        d.set(token, forKey: "accessToken")
        d.set("", forKey: "apiKey")
        me = user
        signedIn = true
    }

    func signInOwner(apiKey: String, userId: String) {
        let d = UserDefaults.standard
        d.set(apiKey, forKey: "apiKey")
        d.set(userId, forKey: "devUserId")
        signedIn = true
    }

    func signOut() {
        let d = UserDefaults.standard
        d.set("", forKey: "accessToken")
        d.set("", forKey: "apiKey")
        balance = nil; motivation = nil; me = nil
        signedIn = false
    }

    func handleUnauthorized() {
        // Only an expired account token signs the user out; a wrong owner key is fixed in settings.
        if !(UserDefaults.standard.string(forKey: "accessToken") ?? "").isEmpty,
           (UserDefaults.standard.string(forKey: "apiKey") ?? "").isEmpty {
            signOut()
            error = "انتهت الجلسة — سجّل الدخول مرة أخرى"
        }
    }
}
