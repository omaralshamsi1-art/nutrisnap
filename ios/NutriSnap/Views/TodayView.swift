import SwiftUI

struct TodayView: View {
    @Environment(AppStore.self) private var store
    var onLog: () -> Void = {}

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    header
                    if let b = store.balance {
                        EnergyCard(balance: b)
                        if b.pendingDrafts.calories > 0 {
                            Notice(text: t("You have draft meals (\(fmt(b.pendingDrafts.calories)) kcal) not counted yet — open and confirm them.", "لديك وجبات مسودة (\(fmt(b.pendingDrafts.calories)) سعرة) لم تُحسب بعد — افتحها وأكّدها."), level: "warn")
                        }
                        MacrosCard(balance: b)
                        if let r = b.ramadan, r.active || r.needsChoice { RamadanCard(view: r) }
                        if let tips = b.tips, !tips.isEmpty, store.isToday {
                            VStack(spacing: 8) { ForEach(tips, id: \.self) { Notice(text: $0.text, level: $0.kind == "over" ? "warn" : "info") } }
                        }
                        if store.isToday, let c = store.motivation?.challenge { ChallengeCard(challenge: c) }
                        if store.isToday { SuggestCard() }
                        if let a = b.activity { ActivityCard(activity: a) }
                        MealsCard(meals: b.meals, onLog: onLog)
                    } else if let e = store.error {
                        Card { VStack(spacing: 10) {
                            Image(systemName: "wifi.exclamationmark").font(.largeTitle).foregroundStyle(Theme.muted)
                            Text(t("Couldn't connect", "تعذّر الاتصال")).font(.headline)
                            Text(e).font(.footnote).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
                            Button(t("Try again", "إعادة المحاولة")) { Task { await store.refresh() } }.buttonStyle(SoftButtonStyle())
                        }.frame(maxWidth: .infinity) }
                    } else {
                        ProgressView().padding(60)
                    }
                }
                .padding(16)
            }
            .screenBackground()
            .refreshable { await store.refresh() }
            .navigationDestination(for: String.self) { MealLoaderView(mealId: $0) }
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(store.isToday ? t("Today", "اليوم") : store.day.arWeekday)
                    .font(.title.bold()).foregroundStyle(Theme.ink)
                Text(store.day.arDayMonth)
                    .font(.subheadline).foregroundStyle(Theme.muted)
            }
            Spacer()
            if let s = store.motivation?.streak, s.current > 0 {
                Chip(text: "\(s.current) \(s.current == 1 ? t("day", "يوم") : t("days", "أيام"))", icon: "flame.fill", fg: Theme.warn, bg: Theme.accentSoft)
            }
            HStack(spacing: 0) {
                Button { store.shiftDay(-1) } label: { Image(systemName: "chevron.backward").frame(width: 36, height: 36) }
                Button { store.shiftDay(1) } label: { Image(systemName: "chevron.forward").frame(width: 36, height: 36) }
                    .disabled(store.isToday)
            }
            .font(.headline)
            .background(Theme.card, in: Capsule())
        }
    }
}

// MARK: Energy ring

struct EnergyCard: View {
    let balance: Balance

    var body: some View {
        let target = balance.targetIntakeKcal ?? 0
        let eaten = balance.intake.calories
        let remaining = balance.remainingKcal ?? (target - eaten)
        let within = remaining >= 0
        let progress = target > 0 ? eaten / target : 0

        Card {
            VStack(spacing: 16) {
                HStack {
                    Chip(text: within ? t("On target", "ضمن الهدف") : t("Over target", "فوق الهدف"),
                         icon: within ? "checkmark.circle.fill" : "exclamationmark.circle.fill",
                         fg: Theme.status(within), bg: Theme.statusSoft(within))
                    Spacer()
                    Text(goalName(balance.goal)).font(.caption).foregroundStyle(Theme.muted)
                }
                ZStack {
                    Circle().stroke(Theme.ringTrack, lineWidth: 16)
                    Circle().trim(from: 0, to: min(progress, 1))
                        .stroke(Theme.status(within), style: StrokeStyle(lineWidth: 16, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .animation(.easeOut(duration: 0.6), value: progress)
                        .environment(\.layoutDirection, .leftToRight)
                    VStack(spacing: 2) {
                        Text(fmt(abs(remaining)))
                            .font(.system(size: 44, weight: .bold, design: .rounded)).monospacedDigit()
                            .foregroundStyle(Theme.status(within))
                        Text(within ? t("kcal left", "سعرة متبقية") : t("kcal over target", "سعرة فوق الهدف")).font(.subheadline).foregroundStyle(Theme.muted)
                    }
                }
                .frame(width: 190, height: 190)

                HStack(spacing: 0) {
                    stat(t("Eaten", "أكلت"), eaten, "fork.knife", Theme.ink)
                    Divider().frame(height: 34)
                    stat(balance.burnIsPartialDay ? t("Burned so far", "حرقت حتى الآن") : t("Burned", "حرقت"), balance.burn?.totalKcal ?? balance.estimatedTdee, "flame.fill", Theme.accent)
                    Divider().frame(height: 34)
                    stat(t("Target", "هدفك"), target, "target", Theme.brand2)
                }
                if let burn = balance.burn {
                    let net = burn.totalKcal - eaten
                    HStack(spacing: 6) {
                        Text(t("Difference (burn − food):", "الفرق (الحرق − الأكل):")).foregroundStyle(Theme.muted)
                        Text(signed(net)).bold().foregroundStyle(Theme.status(net >= 0))
                            .environment(\.layoutDirection, .leftToRight)
                        Text("• \(sourceName(burn.source))").foregroundStyle(Theme.muted)
                    }
                    .font(.footnote)
                } else {
                    Text(t("Burn is estimated — connect Apple Health or WHOOP from the Plan tab", "الحرق تقديري — اربط Apple Health أو WHOOP من صفحة الخطة")).font(.caption).foregroundStyle(Theme.muted)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func stat(_ title: String, _ v: Double?, _ icon: String, _ color: Color) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon).foregroundStyle(color).font(.footnote)
            Text(v.map(fmt) ?? "—").font(.headline).monospacedDigit().foregroundStyle(Theme.ink)
            Text(title).font(.caption2).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity)
    }
}

func goalName(_ g: String) -> String { ["lose": t("Lose weight", "إنقاص الوزن"), "maintain": t("Maintain weight", "المحافظة على الوزن"), "gain": t("Gain weight", "زيادة الوزن")][g] ?? g }

struct MacrosCard: View {
    let balance: Balance
    var body: some View {
        let n = balance.intake, t = balance.macroTargets
        Card(title: t("Nutrients", "العناصر الغذائية"), icon: "chart.bar.fill") {
            VStack(spacing: 12) {
                MacroProgress(title: t("Protein", "بروتين"), value: n.proteinG, target: t?.proteinG, color: Theme.protein)
                MacroProgress(title: t("Carbs", "كربوهيدرات"), value: n.carbsG, target: t?.carbsG, color: Theme.carbs)
                MacroProgress(title: t("Fat", "دهون"), value: n.fatG, target: t?.fatG, color: Theme.fat)
                MacroProgress(title: t("Fibre", "ألياف"), value: n.fiberG, target: t?.fiberG, color: Theme.fiber)
            }
        }
    }
}

// MARK: Ramadan

struct RamadanCard: View {
    @Environment(AppStore.self) private var store
    let view: RamadanView
    var body: some View {
        Card(title: t("Ramadan mode", "وضع رمضان"), icon: "moon.stars.fill") {
            if view.needsChoice && !view.active {
                Text(t("Ramadan Mubarak! Turn on Ramadan mode? We'll split your calories between suhoor and iftar.", "رمضان مبارك! هل تريد تفعيل وضع رمضان؟ نقسّم سعراتك بين السحور والإفطار.")).font(.subheadline)
                HStack {
                    Button(t("Turn on", "تفعيل")) { Task { await set(true) } }.buttonStyle(PrimaryButtonStyle())
                    Button(t("Not now", "ليس الآن")) { Task { await set(false) } }.buttonStyle(SoftButtonStyle())
                }
            } else {
                if view.fasting, let m = view.minutesToIftar {
                    Chip(text: t("\(m / 60) h \(m % 60) min to iftar", "باقي على الإفطار \(m / 60) س \(m % 60) د"), icon: "clock", fg: Theme.warn, bg: Theme.accentSoft)
                }
                if let s = view.split {
                    HStack {
                        part(t("Suhoor", "السحور"), s.suhoor, view.suhoorTime)
                        part(t("Iftar", "الإفطار"), s.iftar, view.iftarTime)
                        part(t("Evening", "المساء"), s.evening, nil)
                    }
                }
            }
        }
    }
    private func part(_ label: String, _ kcal: Double, _ time: String?) -> some View {
        VStack(spacing: 3) {
            Text(label).font(.caption).foregroundStyle(Theme.muted)
            Text(fmt(kcal)).font(.headline).monospacedDigit()
            if let time { Text(time).font(.caption2).foregroundStyle(Theme.muted).environment(\.layoutDirection, .leftToRight) }
        }
        .frame(maxWidth: .infinity).padding(.vertical, 8)
        .background(Theme.card2, in: RoundedRectangle(cornerRadius: 12))
    }
    private func set(_ on: Bool) async {
        if let prof = try? await APIClient.shared.profile() {
            let r = prof.ramadan
            let patch: [String: Any] = ["enabled": on, "suhoorTime": r?.suhoorTime ?? "04:45", "iftarTime": r?.iftarTime ?? "18:00"]
            _ = try? await APIClient.shared.updateProfile(["ramadan": patch])
        }
        await store.refresh()
    }
}

// MARK: Challenge

struct ChallengeCard: View {
    let challenge: Motivation.Challenge
    var body: some View {
        Card(title: t("Weekly challenge", "تحدي الأسبوع"), icon: "trophy.fill",
             trailing: AnyView(Text(challenge.done ? t("Done ✓", "أُنجز ✓") : t("\(challenge.daysLeft) \(challenge.daysLeft == 1 ? t("day", "يوم") : t("days", "أيام")) left", "باقي \(challenge.daysLeft) \(challenge.daysLeft == 1 ? t("day", "يوم") : t("days", "أيام"))"))
                .font(.caption).foregroundStyle(challenge.done ? Theme.good : Theme.muted))) {
            Text(challenge.title).font(.subheadline.weight(.semibold))
            ProgressView(value: min(challenge.progress, challenge.target), total: max(challenge.target, 1))
                .tint(challenge.done ? Theme.good : Theme.accent)
            Text(t("\(fmt(challenge.progress)) of \(fmt(challenge.target)) \(challenge.unitText)", "\(fmt(challenge.progress)) من \(fmt(challenge.target)) \(challenge.unitText)")).font(.caption).foregroundStyle(Theme.muted)
        }
    }
}

// MARK: Coach suggestions

struct SuggestCard: View {
    @State private var data: Suggestions?
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Card(title: t("What should I eat now?", "ماذا آكل الآن؟"), icon: "sparkles",
             trailing: data == nil ? nil : AnyView(Button { Task { await load(force: true) } } label: { Image(systemName: "arrow.clockwise") })) {
            if let data {
                if !data.introAr.isEmpty { Text(data.introAr).font(.subheadline).foregroundStyle(Theme.muted) }
                ForEach(data.options, id: \.self) { o in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(o.titleAr).font(.subheadline.weight(.semibold))
                            Spacer()
                            Text(t("\(fmt(o.kcal)) kcal", "\(fmt(o.kcal)) سعرة")).font(.caption.weight(.bold)).monospacedDigit()
                        }
                        Text(t("\(o.whereAr) • \(fmt(o.proteinG)) g protein", "\(o.whereAr) • \(fmt(o.proteinG)) غ بروتين")).font(.caption).foregroundStyle(Theme.protein)
                        Text(o.whyAr).font(.caption).foregroundStyle(Theme.muted)
                    }
                    .padding(12)
                    .background(Theme.card2, in: RoundedRectangle(cornerRadius: 14))
                }
                if data.options.isEmpty { Text(t("No suitable options right now — try again later.", "لا خيارات مناسبة الآن — جرّب لاحقاً.")).font(.footnote).foregroundStyle(Theme.muted) }
            } else {
                Text(t("Suggestions that fit the calories and protein you have left today.", "اقتراحات تناسب ما تبقى من سعراتك وبروتينك اليوم.")).font(.footnote).foregroundStyle(Theme.muted)
                Button { Task { await load() } } label: {
                    if busy { ProgressView() } else { Label(t("Suggest something", "اقترح عليّ"), systemImage: "wand.and.stars") }
                }
                .buttonStyle(SoftButtonStyle()).disabled(busy)
            }
            if let error { Text(error).font(.caption).foregroundStyle(Theme.bad) }
        }
    }

    private func load(force: Bool = false) async {
        busy = true; error = nil
        defer { busy = false }
        do { data = try await APIClient.shared.suggest(force: force) } catch { self.error = error.localizedDescription }
    }
}

// MARK: Activity

struct ActivityCard: View {
    let activity: DayActivity
    var body: some View {
        Card(title: t("Activity", "النشاط"), icon: "figure.run",
             trailing: activity.workouts.isEmpty ? nil : AnyView(Text(t("\(fmt(activity.totalMin)) min • \(fmt(activity.totalKcal)) kcal", "\(fmt(activity.totalMin)) د • \(fmt(activity.totalKcal)) سعرة")).font(.caption).foregroundStyle(Theme.muted))) {
            if activity.workouts.isEmpty {
                Text(t("No workouts recorded for this day.", "لا تمارين مسجلة لهذا اليوم.")).font(.footnote).foregroundStyle(Theme.muted)
            }
            ForEach(activity.workouts) { w in
                HStack(spacing: 12) {
                    Image(systemName: sportIcon(w.kind))
                        .font(.title3).foregroundStyle(Theme.brand2)
                        .frame(width: 42, height: 42)
                        .background(Theme.brandSoft, in: RoundedRectangle(cornerRadius: 12))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(w.displayName).font(.subheadline.weight(.semibold))
                        Text(details(w)).font(.caption).foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(t("\(fmt(w.kcal ?? 0)) kcal", "\(fmt(w.kcal ?? 0)) سعرة")).font(.subheadline.weight(.semibold)).monospacedDigit()
                        Text(sourceName(w.source)).font(.caption2).foregroundStyle(Theme.muted)
                    }
                }
            }
        }
    }
    private func details(_ w: Workout) -> String {
        var parts = [t("\(fmt(w.durationMin)) min", "\(fmt(w.durationMin)) د"), w.start.arTime]
        if let s = w.strain { parts.append(t("Strain \(fmt1(s))", "إجهاد \(fmt1(s))")) }
        if let hr = w.avgHr { parts.append(t("HR \(fmt(hr))", "نبض \(fmt(hr))")) }
        if let d = w.distanceM, d > 0 { parts.append(t("\(fmt1(d / 1000)) km", "\(fmt1(d / 1000)) كم")) }
        return parts.joined(separator: " • ")
    }
}

// MARK: Meals

struct MealsCard: View {
    let meals: [Balance.MealRow]
    var onLog: () -> Void
    var body: some View {
        Card(title: t("Today's meals", "وجبات اليوم"), icon: "fork.knife") {
            if meals.isEmpty {
                Text(t("No meals yet.", "لا وجبات بعد.")).font(.footnote).foregroundStyle(Theme.muted)
                Button(action: onLog) { Label(t("Log your meal", "سجّل وجبتك"), systemImage: "camera.fill") }.buttonStyle(SoftButtonStyle())
            }
            ForEach(meals) { m in
                NavigationLink(value: m.id) {
                    HStack(spacing: 12) {
                        Image(systemName: m.status == "confirmed" ? "checkmark.seal.fill" : "hourglass")
                            .foregroundStyle(m.status == "confirmed" ? Theme.good : Theme.warn)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(m.displayName).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                                .lineLimit(1)
                            Text([m.restaurant, m.eatenAt.arTime].compactMap { $0 }.joined(separator: " • "))
                                .font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(fmt(m.calories)).font(.subheadline.weight(.bold)).monospacedDigit().foregroundStyle(Theme.ink)
                            if let p = m.proteinG { Text(t("\(fmt(p)) g protein", "\(fmt(p)) غ بروتين")).font(.caption2).foregroundStyle(Theme.protein) }
                        }
                        Image(systemName: "chevron.forward").font(.caption).foregroundStyle(Theme.muted)
                    }
                    .padding(.vertical, 4)
                }
                .buttonStyle(.plain)
                if m.id != meals.last?.id { Divider() }
            }
        }
    }
}

struct MealLoaderView: View {
    let mealId: String
    @State private var meal: Meal?
    @State private var error: String?
    var body: some View {
        Group {
            if let meal { MealReviewView(meal: meal) }
            else if let error { Text(error).padding() }
            else { ProgressView() }
        }
        .task {
            do { meal = try await APIClient.shared.meal(id: mealId) } catch { self.error = error.localizedDescription }
        }
    }
}
