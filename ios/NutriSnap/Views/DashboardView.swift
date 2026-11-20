import SwiftUI

struct DashboardView: View {
    @Environment(AppStore.self) private var store
    @State private var day = Date()

    var body: some View {
        NavigationStack {
            List {
                if let b = store.balance {
                    Section { EnergyRing(balance: b).listRowBackground(Color.clear) }
                    Section("الحرق مقابل الأكل") {
                        row("أكلت", b.intake.calories, "fork.knife")
                        if let burn = b.burn {
                            row("حرقت (\(sourceName(burn.source)))", burn.totalKcal, "flame.fill")
                            if let a = burn.activeKcal, let bas = burn.basalKcal {
                                Text("نشط \(Int(a)) • أساسي \(Int(bas))").font(.caption).foregroundStyle(.secondary)
                            }
                            if b.burnIsPartialDay {
                                Text("الحرق حتى الآن — الهدف محسوب على تقدير اليوم الكامل").font(.caption2).foregroundStyle(.secondary)
                            }
                        } else {
                            Text("أكمل ملفك أو اربط Apple Health / WHOOP لحساب الحرق").foregroundStyle(.secondary)
                        }
                        if let target = b.targetIntakeKcal { row("هدفك اليوم", target, "target") }
                        if b.pendingDrafts.calories > 0 {
                            row("وجبات بانتظار التأكيد", b.pendingDrafts.calories, "hourglass").foregroundStyle(.orange)
                        }
                    }
                    Section("العناصر الغذائية") {
                        MacroBar(n: b.intake)
                    }
                    Section("وجبات اليوم") {
                        if b.meals.isEmpty { Text("لا توجد وجبات بعد — صوّر وجبتك الأولى").foregroundStyle(.secondary) }
                        ForEach(b.meals) { m in
                            NavigationLink(value: m.id) {
                                HStack {
                                    VStack(alignment: .leading) {
                                        Text(m.nameAr.isEmpty ? m.name : m.nameAr).font(.headline)
                                        Text([m.restaurant, m.eatenAt.formatted(date: .omitted, time: .shortened)]
                                            .compactMap { $0 }.joined(separator: " • "))
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    VStack(alignment: .trailing) {
                                        Text("\(Int(m.calories)) سعرة").bold()
                                        if m.status != "confirmed" { Text("مسودة").font(.caption2).foregroundStyle(.orange) }
                                    }
                                }
                            }
                        }
                    }
                } else if let e = store.error {
                    ContentUnavailableView("تعذّر الاتصال", systemImage: "wifi.exclamationmark", description: Text(e))
                } else {
                    ProgressView()
                }
            }
            .navigationTitle(day.formatted(.dateTime.weekday(.wide).day().month()))
            .navigationDestination(for: String.self) { MealLoaderView(mealId: $0) }
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button { shift(-1) } label: { Image(systemName: "chevron.right") }
                    Button { shift(1) } label: { Image(systemName: "chevron.left") }
                        .disabled(Calendar.current.isDateInToday(day))
                }
            }
            .refreshable { await store.refresh(date: day) }
        }
    }

    private func shift(_ d: Int) {
        day = Calendar.current.date(byAdding: .day, value: d, to: day)!
        Task { await store.refresh(date: day) }
    }

    private func row(_ title: String, _ kcal: Double, _ icon: String) -> some View {
        HStack { Label(title, systemImage: icon); Spacer(); Text("\(Int(kcal)) سعرة").monospacedDigit() }
    }

    private func sourceName(_ s: String) -> String {
        ["apple_health": "Apple Health", "whoop": "WHOOP", "health_connect": "Health Connect",
         "garmin": "Garmin", "fitbit": "Fitbit", "manual": "يدوي", "estimate": "تقدير"][s] ?? s
    }
}

struct EnergyRing: View {
    let balance: Balance
    var body: some View {
        let target = balance.targetIntakeKcal ?? 0
        let eaten = balance.intake.calories
        let progress = target > 0 ? min(eaten / target, 1.5) : 0
        ZStack {
            Circle().stroke(.quaternary, lineWidth: 18)
            Circle().trim(from: 0, to: min(progress, 1))
                .stroke(progress > 1 ? Color.red : Color.green, style: StrokeStyle(lineWidth: 18, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack {
                if let r = balance.remainingKcal {
                    Text("\(Int(abs(r)))").font(.system(size: 40, weight: .bold)).monospacedDigit()
                    Text(r >= 0 ? "سعرة متبقية" : "سعرة فوق الهدف").foregroundStyle(.secondary)
                } else {
                    Text("\(Int(eaten))").font(.system(size: 40, weight: .bold))
                    Text("سعرة اليوم").foregroundStyle(.secondary)
                }
            }
        }
        .frame(height: 200).padding(.vertical)
    }
}

struct MacroBar: View {
    let n: Nutrients
    var body: some View {
        HStack {
            macro("بروتين", n.proteinG, .blue)
            macro("كربوهيدرات", n.carbsG, .orange)
            macro("دهون", n.fatG, .pink)
            macro("ألياف", n.fiberG, .green)
        }
    }
    private func macro(_ t: String, _ g: Double, _ c: Color) -> some View {
        VStack { Text("\(Int(g)) غ").bold().foregroundStyle(c); Text(t).font(.caption) }.frame(maxWidth: .infinity)
    }
}

struct MealLoaderView: View {
    let mealId: String
    @State private var meal: Meal?
    @State private var error: String?
    var body: some View {
        Group {
            if let meal { MealReviewView(meal: meal) }
            else if let error { Text(error) }
            else { ProgressView() }
        }
        .task {
            do { meal = try await APIClient.shared.meal(id: mealId) } catch { self.error = error.localizedDescription }
        }
    }
}
