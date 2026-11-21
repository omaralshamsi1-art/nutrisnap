import Foundation
import UserNotifications

/// Local meal reminders built from the eating schedule:
/// - every day, 10 minutes before each slot ("time for lunch — ~600 kcal")
/// - today only, 1 hour after a meal slot that still has nothing logged (refreshed whenever the schedule loads)
enum MealNotifications {
    static let enabledKey = "mealReminders"
    static var enabled: Bool { UserDefaults.standard.object(forKey: enabledKey) as? Bool ?? false }

    static func requestPermission() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    static func clear() async {
        let center = UNUserNotificationCenter.current()
        let ids = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix("slot-") }
        center.removePendingNotificationRequests(withIdentifiers: ids)
    }

    static func sync(_ day: DaySchedule) async {
        guard enabled else { return }
        await clear()
        let center = UNUserNotificationCenter.current()
        for s in day.slots {
            let parts = s.time.split(separator: ":").compactMap { Int($0) }
            guard parts.count == 2 else { continue }
            let at = parts[0] * 60 + parts[1]

            // daily "before" reminder
            let before = (at - 10 + 1440) % 1440
            var dc = DateComponents(); dc.hour = before / 60; dc.minute = before % 60
            let c = UNMutableNotificationContent()
            c.title = s.kind == "snack" ? t("🍎 \(s.label) time", "🍎 وقت \(s.label)") : t("🍽️ \(s.label) time", "🍽️ وقت \(s.label)")
            c.body = t("Aim for about \(Int(s.targetKcal)) kcal. Open \"What should I eat now?\" for ideas.",
                       "هدفك حوالي \(Int(s.targetKcal)) سعرة. افتح \"ماذا آكل الآن؟\" لاقتراحات جاهزة.")
            c.sound = .default
            try? await center.add(UNNotificationRequest(identifier: "slot-\(s.id)-before", content: c,
                                                        trigger: UNCalendarNotificationTrigger(dateMatching: dc, repeats: true)))

            // today's "not logged yet" reminder for meals
            guard s.kind == "meal", s.status != "done" else { continue }
            let cal = Calendar.current
            guard let due = cal.date(bySettingHour: (at + 60) / 60 % 24, minute: (at + 60) % 60, second: 0, of: Date()), due > Date() else { continue }
            let m = UNMutableNotificationContent()
            m.title = t("\(s.label) not logged yet", "لم تسجّل \(s.label) بعد")
            m.body = t("Snap your meal or pick a favourite in one tap.", "صوّر وجبتك أو اختر من المفضلة بضغطة واحدة.")
            m.sound = .default
            let comps = cal.dateComponents([.year, .month, .day, .hour, .minute], from: due)
            try? await center.add(UNNotificationRequest(identifier: "slot-\(s.id)-missed", content: m,
                                                        trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
        }
    }
}
