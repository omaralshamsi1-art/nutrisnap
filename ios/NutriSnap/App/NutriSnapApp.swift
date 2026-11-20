import SwiftUI

@main
struct NutriSnapApp: App {
    @State private var store = AppStore()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            TabView {
                DashboardView()
                    .tabItem { Label("اليوم", systemImage: "flame") }
                CaptureView()
                    .tabItem { Label("صوّر وجبة", systemImage: "camera") }
                SettingsView()
                    .tabItem { Label("الإعدادات", systemImage: "gearshape") }
            }
            .environment(store)
            .environment(\.layoutDirection, .rightToLeft)
            .task {
                try? await HealthKitManager.shared.requestAuthorization()
                HealthKitManager.shared.enableBackgroundSync()
                await store.refresh()
            }
            .onChange(of: phase) { _, p in
                if p == .active { Task { await store.refresh() } }
            }
        }
    }
}

/// App-wide state: today's balance, refreshed after any change.
@MainActor @Observable
final class AppStore {
    var balance: Balance?
    var error: String?
    var isLoading = false
    var whoopConnected = UserDefaults.standard.bool(forKey: "whoopConnected")

    func refresh(date: Date = Date()) async {
        isLoading = true
        defer { isLoading = false }
        await HealthKitManager.shared.syncBurnToServer()
        await HealthKitManager.shared.syncWorkoutsToServer()
        if whoopConnected {
            let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: date)!
            try? await APIClient.shared.whoopSync(from: yesterday, to: date)
        }
        do {
            balance = try await APIClient.shared.balance(date: date)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func setWhoop(_ on: Bool) {
        whoopConnected = on
        UserDefaults.standard.set(on, forKey: "whoopConnected")
    }
}
