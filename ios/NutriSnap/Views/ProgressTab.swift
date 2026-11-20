import Charts
import SwiftUI

struct ProgressTab: View {
    @Environment(AppStore.self) private var store
    @State private var weights: WeightLog?
    @State private var plan: Plan?
    @State private var history: History?
    @State private var motivation: Motivation?
    @State private var newWeight = ""
    @State private var message: String?
    @FocusState private var weightFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    if let plan { GoalProgressCard(plan: plan) }
                    weightCard
                    if let history { WeekBarsCard(history: history) }
                    WeeklyReportCard()
                    if let m = motivation ?? store.motivation { BadgesCard(motivation: m) }
                }
                .padding(16)
            }
            .screenBackground()
            .navigationTitle("التقدم")
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private var weightCard: some View {
        Card(title: "الوزن", icon: "scalemass.fill",
             trailing: weights?.current.map { AnyView(Text("\(fmt1($0)) كغ").font(.headline).monospacedDigit()) }) {
            if let entries = weights?.entries, entries.count >= 2 {
                Chart {
                    ForEach(entries) { e in
                        PointMark(x: .value("اليوم", e.day), y: .value("الوزن", e.kg))
                            .foregroundStyle(Theme.muted.opacity(0.5)).symbolSize(18)
                        LineMark(x: .value("اليوم", e.day), y: .value("الاتجاه", e.trend))
                            .foregroundStyle(Theme.brand2).lineStyle(StrokeStyle(lineWidth: 3)).interpolationMethod(.monotone)
                    }
                    if let t = plan?.targetWeightKg {
                        RuleMark(y: .value("الهدف", t))
                            .foregroundStyle(Theme.accent).lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                            .annotation(position: .top, alignment: .leading) { Text("الهدف \(fmt1(t))").font(.caption2).foregroundStyle(Theme.accent) }
                    }
                }
                .chartYScale(domain: yDomain(entries))
                .frame(height: 190)
                .environment(\.layoutDirection, .leftToRight)
                Text("الخط = الاتجاه الحقيقي (يخفف تقلبات الماء اليومية)").font(.caption2).foregroundStyle(Theme.muted)
            } else {
                Text("سجّل وزنك صباحاً عدة أيام ليظهر الرسم والاتجاه.").font(.footnote).foregroundStyle(Theme.muted)
            }
            HStack {
                TextField("وزن اليوم (كغ)", text: $newWeight)
                    .keyboardType(.decimalPad).focused($weightFocused)
                    .padding(11).background(Theme.card2, in: RoundedRectangle(cornerRadius: 12))
                Button("سجّل") { Task { await addWeight() } }
                    .buttonStyle(PrimaryButtonStyle()).frame(width: 90)
            }
            if let message { Text(message).font(.caption).foregroundStyle(Theme.muted) }
        }
    }

    private func yDomain(_ e: [WeightEntry]) -> ClosedRange<Double> {
        var vals = e.flatMap { [$0.kg, $0.trend] }
        if let t = plan?.targetWeightKg { vals.append(t) }
        let lo = (vals.min() ?? 60) - 1, hi = (vals.max() ?? 90) + 1
        return lo...hi
    }

    private func addWeight() async {
        let kg = Double(newWeight.replacingOccurrences(of: ",", with: ".").replacingOccurrences(of: "٫", with: ".")) ?? 0
        guard kg >= 25, kg <= 350 else { message = "أدخل وزناً صحيحاً"; return }
        do {
            try await APIClient.shared.addWeight(kg)
            newWeight = ""; weightFocused = false; message = "تم تسجيل الوزن ✓"
            await load()
            await store.refresh()
        } catch { message = error.localizedDescription }
    }

    private func load() async {
        async let w = APIClient.shared.weights(days: 90)
        async let p = APIClient.shared.plan()
        async let h = APIClient.shared.history(days: 7)
        async let m = APIClient.shared.motivation()
        weights = try? await w
        plan = try? await p
        history = try? await h
        motivation = try? await m
    }
}

struct GoalProgressCard: View {
    let plan: Plan
    var body: some View {
        Card(title: "نحو هدفك", icon: "flag.checkered") {
            if let start = plan.startWeightKg, let cur = plan.currentWeightKg, let target = plan.targetWeightKg, plan.goal != "maintain" {
                let pct = max(0, min(100, plan.progressPct ?? 0))
                HStack {
                    col("البداية", "\(fmt1(start))")
                    col("الآن", "\(fmt1(cur))")
                    col("الهدف", "\(fmt1(target))")
                }
                ProgressView(value: pct, total: 100).tint(Theme.good)
                HStack {
                    if let ch = plan.changeSinceStartKg {
                        let good = plan.goal == "gain" ? ch >= 0 : ch <= 0
                        Text("التغيّر:").foregroundStyle(Theme.muted)
                        Text(signedKg(ch)).bold().foregroundStyle(Theme.status(good))
                    }
                    Spacer()
                    Text("\(fmt(pct))٪").font(.caption.bold()).foregroundStyle(Theme.good)
                }
                .font(.footnote)
                if let eta = plan.etaDate, let d = DateFormatter.isoDay.date(from: eta) {
                    Text("الموعد المتوقع: \(d.arMonthYear)").font(.footnote).foregroundStyle(Theme.muted)
                }
            } else {
                Text("هدفك: \(goalName(plan.effectiveGoal)) — \(fmt(plan.targetKcal)) سعرة يومياً").font(.subheadline)
            }
        }
    }
    private func col(_ t: String, _ v: String) -> some View {
        VStack(spacing: 2) {
            Text(v).font(.title3.bold()).monospacedDigit()
            Text("\(t) (كغ)").font(.caption2).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity)
    }
}

struct WeekBarsCard: View {
    let history: History
    var body: some View {
        Card(title: "آخر 7 أيام", icon: "calendar",
             trailing: AnyView(Text("\(history.daysOnTarget) من \(history.loggedDays) ضمن الهدف").font(.caption).foregroundStyle(Theme.muted))) {
            Chart {
                ForEach(history.days) { d in
                    let ok = d.targetKcal.map { d.intakeKcal <= $0 } ?? true
                    BarMark(x: .value("اليوم", d.day, unit: .day), y: .value("سعرات", d.intakeKcal))
                        .foregroundStyle(d.meals == 0 ? Theme.ringTrack : Theme.status(ok))
                        .cornerRadius(6)
                }
                if let t = history.days.last?.targetKcal {
                    RuleMark(y: .value("الهدف", t)).foregroundStyle(Theme.muted).lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                }
            }
            .chartXAxis {
                AxisMarks(values: .stride(by: .day)) { _ in
                    AxisValueLabel(format: .dateTime.weekday(.narrow))
                }
            }
            .frame(height: 160)
            .environment(\.layoutDirection, .leftToRight)
            if let avg = history.avgIntakeKcal {
                Text("متوسط الأكل في الأيام المسجلة: \(fmt(avg)) سعرة").font(.caption).foregroundStyle(Theme.muted)
            }
        }
    }
}

struct WeeklyReportCard: View {
    @State private var report: WeeklyReport?
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Card(title: "تقرير الأسبوع", icon: "doc.text.magnifyingglass") {
            if let r = report {
                Text(r.narrative.headlineAr).font(.subheadline.weight(.semibold))
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                    tile("أيام مسجلة", "\(r.stats.loggedDays)/7")
                    tile("ضمن الهدف", "\(r.stats.daysOnTarget)")
                    tile("متوسط الأكل", r.stats.avgKcal.map(fmt) ?? "—")
                    tile("متوسط البروتين", r.stats.avgProtein.map { "\(fmt($0)) غ" } ?? "—")
                    if let d = r.stats.avgDeficit { tile("متوسط الفرق", signed(d), color: Theme.status(r.stats.goal == "gain" ? d <= 0 : d >= 0)) }
                    if let w = r.stats.weightChangeKg { tile("تغيّر الوزن", signedKg(w)) }
                }
                bullets("ما أحسنت فيه", r.narrative.winsAr, Theme.good, "checkmark.circle.fill")
                bullets("ما يمكن تحسينه", r.narrative.improveAr, Theme.warn, "arrow.up.right.circle.fill")
                Notice(text: r.narrative.nextWeekGoalAr)
            } else {
                Text("ملخص أسبوعك الماضي مع نصائح من المدرب.").font(.footnote).foregroundStyle(Theme.muted)
                Button { Task { await load() } } label: {
                    if busy { ProgressView() } else { Label("اعرض التقرير", systemImage: "doc.text") }
                }
                .buttonStyle(SoftButtonStyle()).disabled(busy)
            }
            if let error { Text(error).font(.caption).foregroundStyle(Theme.bad) }
        }
    }
    private func tile(_ t: String, _ v: String, color: Color = Theme.ink) -> some View {
        VStack(spacing: 2) {
            Text(v).font(.headline).monospacedDigit().foregroundStyle(color).environment(\.layoutDirection, .leftToRight)
            Text(t).font(.caption2).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 8)
        .background(Theme.card2, in: RoundedRectangle(cornerRadius: 12))
    }
    @ViewBuilder private func bullets(_ title: String, _ items: [String], _ color: Color, _ icon: String) -> some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.caption.weight(.bold)).foregroundStyle(color)
                ForEach(items, id: \.self) { t in
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: icon).foregroundStyle(color).font(.caption)
                        Text(t).font(.footnote).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }
    private func load() async {
        busy = true; error = nil
        defer { busy = false }
        do { report = try await APIClient.shared.weekly() } catch { self.error = error.localizedDescription }
    }
}

struct BadgesCard: View {
    let motivation: Motivation
    var body: some View {
        Card(title: "الأوسمة", icon: "rosette",
             trailing: AnyView(Text("\(motivation.earnedCount) من \(motivation.badges.count)").font(.caption).foregroundStyle(Theme.muted))) {
            HStack {
                Chip(text: "سلسلة \(motivation.streak.current) • الأفضل \(motivation.streak.best)", icon: "flame.fill", fg: Theme.warn, bg: Theme.accentSoft)
                if let o = motivation.onTargetStreak {
                    Chip(text: "ضمن الهدف \(o.current)", icon: "target", fg: Theme.good, bg: Theme.goodSoft)
                }
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                ForEach(motivation.badges) { b in
                    VStack(spacing: 4) {
                        Image(systemName: b.earned ? "medal.fill" : "lock.fill")
                            .font(.title2).foregroundStyle(b.earned ? Theme.accent : Theme.muted.opacity(0.5))
                        Text(b.titleAr).font(.caption.weight(.semibold)).multilineTextAlignment(.center).lineLimit(2)
                        if !b.earned {
                            ProgressView(value: min(b.progress, b.target), total: max(b.target, 1)).tint(Theme.accent)
                        }
                    }
                    .padding(8)
                    .frame(maxWidth: .infinity, minHeight: 92)
                    .background(b.earned ? Theme.accentSoft : Theme.card2, in: RoundedRectangle(cornerRadius: 14))
                    .help(b.descAr)
                }
            }
        }
    }
}
