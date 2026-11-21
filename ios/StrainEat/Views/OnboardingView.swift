import SwiftUI

/// Goal setup in 5 short steps, with a live plan preview from the server.
struct OnboardingView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var existing: Profile? = nil

    @State private var step = 1
    @State private var goal = "lose"
    @State private var sex: String?
    @State private var birthYear = ""
    @State private var height = ""
    @State private var weight = ""
    @State private var activity = "light"
    @State private var target = ""
    @State private var pace = "moderate"
    @State private var pregnant = false
    @State private var medical = false
    @State private var edHistory = false
    @State private var preview: Plan?
    @State private var error: String?
    @State private var busy = false
    @State private var loaded = false

    private let steps = 5
    private let goals = [("lose", t("Lose weight", "إنقاص الوزن"), "arrow.down.circle.fill"), ("maintain", t("Maintain", "المحافظة"), "equal.circle.fill"), ("gain", t("Gain weight", "زيادة الوزن"), "arrow.up.circle.fill")]
    private let activities = [("sedentary", t("Sedentary", "خامل"), t("Desk job, no exercise", "عمل مكتبي بدون رياضة")), ("light", t("Light", "خفيف"), t("Walking or exercise 1–3 days", "مشي أو رياضة 1–3 أيام")),
                              ("moderate", t("Moderate", "متوسط"), t("Exercise 3–5 days", "رياضة 3–5 أيام")), ("active", t("Active", "نشيط"), t("Exercise 6–7 days", "رياضة 6–7 أيام")), ("very_active", t("Very active", "نشيط جداً"), t("Hard training or physical work", "تمارين قوية أو عمل بدني"))]
    private let paces = [("relaxed", t("Relaxed", "مريح"), t("≈0.25% of your weight per week", "≈0.25٪ من وزنك أسبوعياً")), ("moderate", t("Moderate", "متوسط"), t("≈0.5% per week — recommended", "≈0.5٪ أسبوعياً — موصى به")), ("fast", t("Fast", "سريع"), t("≈0.75% per week", "≈0.75٪ أسبوعياً"))]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ProgressView(value: Double(step), total: Double(steps)).tint(Theme.brand2).padding(.horizontal, 20).padding(.top, 8)
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        switch step {
                        case 1: goalStep
                        case 2: bodyStep
                        case 3: activityStep
                        case 4: targetStep
                        default: reviewStep
                        }
                        if let error { Notice(text: error, level: "danger") }
                    }
                    .padding(20)
                }
                HStack(spacing: 10) {
                    if step > 1 {
                        Button(t("Back", "رجوع")) { withAnimation { step -= 1 } }.buttonStyle(SoftButtonStyle()).frame(width: 110)
                    }
                    Button { Task { await next() } } label: {
                        if busy { ProgressView().tint(.white) } else { Text(step == steps ? t("Start my plan", "ابدأ خطتي") : t("Next", "التالي")) }
                    }
                    .buttonStyle(PrimaryButtonStyle()).disabled(busy)
                }
                .padding(20)
            }
            .screenBackground()
            .navigationTitle(existing == nil ? t("Let's set up your plan", "لنضبط خطتك") : t("Edit plan", "تعديل الخطة"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if existing != nil || !store.needsOnboarding {
                    ToolbarItem(placement: .cancellationAction) { Button(t("Cancel", "إلغاء")) { dismiss() } }
                }
            }
            .task { await prefill() }
        }
        .interactiveDismissDisabled(existing == nil)
    }

    // MARK: Steps

    private var goalStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            title(t("What's your goal?", "ما هدفك؟"), t("We build your daily plan from your goal and your real burn.", "نبني خطتك اليومية حسب هدفك وحرقك الحقيقي."))
            ForEach(goals, id: \.0) { g in
                choice(selected: goal == g.0, icon: g.2, title: g.1, subtitle: nil) { goal = g.0 }
            }
        }
    }

    private var bodyStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            title(t("About you", "بياناتك"), t("To calculate your base burn accurately.", "لحساب حرقك الأساسي بدقة."))
            HStack(spacing: 10) {
                choice(selected: sex == "female", icon: "figure.stand.dress", title: t("Female", "أنثى"), subtitle: nil) { sex = "female" }
                choice(selected: sex == "male", icon: "figure.stand", title: t("Male", "ذكر"), subtitle: nil) { sex = "male" }
            }
            numField(t("Year of birth", "سنة الميلاد"), $birthYear, "1998")
            numField(t("Height (cm)", "الطول (سم)"), $height, "165")
            numField(t("Current weight (kg)", "الوزن الحالي (كغ)"), $weight, "80")
        }
    }

    private var activityStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            title(t("Your usual activity", "نشاطك المعتاد"), t("If you connect your watch, we correct this automatically after 7 days of data.", "إذا ربطت ساعتك نصحّح هذا تلقائياً بعد 7 أيام من القياسات."))
            ForEach(activities, id: \.0) { a in
                choice(selected: activity == a.0, icon: "figure.walk", title: a.1, subtitle: a.2) { activity = a.0 }
            }
        }
    }

    private var targetStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            if goal == "maintain" {
                title(t("Maintain your weight", "المحافظة على وزنك"), t("We'll focus on protein, fibre and balanced calories.", "سنركّز على البروتين والألياف وتوازن السعرات."))
            } else {
                title(t("Target weight", "الوزن المستهدف"), t("Pick a safe, sustainable pace.", "اختر سرعة آمنة ومستدامة."))
                numField(t("Target weight (kg)", "الوزن المستهدف (كغ)"), $target, goal == "lose" ? "70" : "75")
                ForEach(paces, id: \.0) { p in
                    choice(selected: pace == p.0, icon: "speedometer", title: p.1, subtitle: p.2) { pace = p.0 }
                }
            }
            Card(title: t("For your safety", "للسلامة"), icon: "cross.case") {
                Toggle(t("Pregnant or breastfeeding", "حامل أو مرضعة"), isOn: $pregnant)
                Toggle(t("I'm seeing a doctor for a health condition", "أتابع مع طبيب لحالة صحية"), isOn: $medical)
                Toggle(t("I've had an eating disorder in the past", "عانيت سابقاً من اضطراب في الأكل"), isOn: $edHistory)
                Text(t("In these cases we set the plan to maintain and avoid strict diets.", "في هذه الحالات نضبط الخطة على المحافظة ونتجنب الحِميات القاسية.")).font(.caption).foregroundStyle(Theme.muted)
            }
        }
    }

    private var reviewStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            title(t("Your plan is ready", "خطتك جاهزة"), t("You can change it any time from the Plan tab.", "يمكنك تعديلها في أي وقت من صفحة الخطة."))
            if let p = preview {
                Card {
                    HStack(alignment: .firstTextBaseline) {
                        Text(fmt(p.targetKcal)).font(.system(size: 44, weight: .bold, design: .rounded)).foregroundStyle(Theme.brand2)
                        Text(t("kcal per day", "سعرة يومياً")).foregroundStyle(Theme.muted)
                    }
                    HStack {
                        stat(t("Protein", "بروتين"), t("\(fmt(p.proteinG)) g", "\(fmt(p.proteinG)) غ"))
                        stat(t("Weekly", "أسبوعياً"), p.weeklyChangeKg.map { $0 == 0 ? "—" : signedKg($0) } ?? "—")
                        stat(t("ETA", "الوصول"), p.etaDate.flatMap { DateFormatter.isoDay.date(from: $0) }.map { $0.formatted(.dateTime.month(.abbreviated).year().locale(appLocale)) } ?? "—")
                    }
                }
                ForEach(p.notices, id: \.self) { Notice(text: $0.text, level: $0.level) }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: Pieces

    private func title(_ heading: String, _ s: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(heading).font(.title2.bold())
            Text(s).font(.subheadline).foregroundStyle(Theme.muted)
        }
    }

    private func choice(selected: Bool, icon: String, title: String, subtitle: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.title2).foregroundStyle(selected ? .white : Theme.brand2).frame(width: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.headline)
                    if let subtitle { Text(subtitle).font(.caption).opacity(0.8) }
                }
                Spacer()
                if selected { Image(systemName: "checkmark.circle.fill") }
            }
            .foregroundStyle(selected ? .white : Theme.ink)
            .padding(14)
            .frame(maxWidth: .infinity)
            .background(selected ? Theme.brand : Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func numField(_ label: String, _ value: Binding<String>, _ placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(Theme.muted)
            TextField(placeholder, text: value).keyboardType(.decimalPad)
                .padding(12).background(Theme.card, in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private func stat(_ label: String, _ v: String) -> some View {
        VStack(spacing: 2) {
            Text(v).font(.subheadline.bold()).environment(\.layoutDirection, .leftToRight)
            Text(label).font(.caption2).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: Logic

    private func num(_ s: String) -> Double? {
        Double(s.replacingOccurrences(of: ",", with: ".").replacingOccurrences(of: t("٫", "٫"), with: ".").trimmingCharacters(in: .whitespaces))
    }

    private func patch() -> [String: Any] {
        var p: [String: Any] = [
            "goal": goal, "activityLevel": activity, "pace": pace,
            "timezone": TimeZone.current.identifier,
            "screening": ["pregnant": pregnant, "breastfeeding": false, "medicalSupervision": medical, "edHistory": edHistory] as [String: Any],
        ]
        if let sex { p["sex"] = sex }
        if let y = num(birthYear) { p["birthYear"] = Int(y) }
        if let h = num(height) { p["heightCm"] = h }
        if let w = num(weight) { p["weightKg"] = w }
        p["targetWeightKg"] = goal == "maintain" ? NSNull() as Any : (num(target).map { $0 as Any } ?? NSNull() as Any)
        return p
    }

    private func next() async {
        error = nil
        switch step {
        case 2:
            guard sex != nil, let y = num(birthYear), let h = num(height), let w = num(weight) else { error = t("Please fill in all four fields", "أكمل الحقول الأربعة"); return }
            guard y > 1920, y < 2015, h >= 100, h <= 250, w >= 25, w <= 350 else { error = t("Check the values", "تحقق من القيم"); return }
        case 4:
            if goal != "maintain" {
                guard let tw = num(target), tw >= 30, tw <= 300 else { error = t("Enter your target weight", "أدخل الوزن المستهدف"); return }
            }
        default: break
        }
        if step < steps {
            withAnimation { step += 1 }
            if step == steps { await loadPreview() }
            return
        }
        busy = true; defer { busy = false }
        do {
            var body = patch()
            let w = body.removeValue(forKey: "weightKg") as? Double
            body["onboarded"] = true
            try await APIClient.shared.updateProfile(body)
            if let w, w != existing?.weightKg { try? await APIClient.shared.addWeight(w) }
            store.needsOnboarding = false
            await store.refresh()
            dismiss()
        } catch { self.error = error.localizedDescription }
    }

    private func loadPreview() async {
        preview = nil
        do { preview = try await APIClient.shared.planPreview(patch()) } catch { self.error = error.localizedDescription }
    }

    private func prefill() async {
        guard !loaded else { return }
        loaded = true
        let p: Profile?
        if let existing { p = existing } else { p = try? await APIClient.shared.profile() }
        guard let p else { return }
        goal = p.goal
        sex = p.sex
        birthYear = p.birthYear.map { String($0) } ?? ""
        height = p.heightCm.map { fmt1($0) } ?? ""
        weight = p.weightKg.map { fmt1($0) } ?? ""
        activity = p.activityLevel
        target = p.targetWeightKg.map { fmt1($0) } ?? ""
        pace = p.pace ?? "moderate"
        pregnant = p.screening?.pregnant ?? false
        medical = p.screening?.medicalSupervision ?? false
        edHistory = p.screening?.edHistory ?? false
    }
}
