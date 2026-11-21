import SwiftUI

struct PlanTab: View {
    @Environment(AppStore.self) private var store
    @State private var plan: Plan?
    @State private var profile: Profile?
    @State private var editing = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    if let plan { PlanSummaryCard(plan: plan, onEdit: { editing = true }) }
                    AccountCard()
                    DevicesCard(profile: profile, onChange: { Task { await load() } })
                    if let profile { RamadanSettingsCard(profile: profile, onSaved: { Task { await load() } }) }
                    Card(title: t("Reminders", "التذكيرات"), icon: "bell.badge") {
                        Text(t("Smart reminders (usual meal time and morning weigh-in) currently run from the web app once it's added to your Home Screen.", "التذكيرات الذكية (موعد الوجبة المعتاد ووزن الصباح) تعمل حالياً من تطبيق الويب بعد إضافته للشاشة الرئيسية."))
                            .font(.footnote).foregroundStyle(Theme.muted)
                    }
                    Card(title: "Language · اللغة", icon: "globe") { LanguagePicker() }
                    if let message { Text(message).font(.footnote).foregroundStyle(Theme.muted) }
                    Text("NutriSnap \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")")
                        .font(.caption2).foregroundStyle(Theme.muted)
                }
                .padding(16)
            }
            .screenBackground()
            .navigationTitle(t("Plan", "الخطة"))
            .refreshable { await load() }
            .task { await load() }
            .sheet(isPresented: $editing, onDismiss: { Task { await load(); await store.refresh() } }) {
                OnboardingView(existing: profile).environment(store).environment(\.layoutDirection, appLayoutDirection)
            }
        }
    }

    private func load() async {
        async let p = APIClient.shared.plan()
        async let pr = APIClient.shared.profile()
        plan = try? await p
        profile = try? await pr
    }
}

// MARK: Plan summary

struct PlanSummaryCard: View {
    let plan: Plan
    var onEdit: () -> Void
    var body: some View {
        Card(title: t("Your daily plan", "خطتك اليومية"), icon: "target",
             trailing: AnyView(Button(t("Edit", "تعديل"), action: onEdit).font(.subheadline.weight(.semibold)))) {
            HStack(alignment: .firstTextBaseline) {
                Text(fmt(plan.targetKcal)).font(.system(size: 40, weight: .bold, design: .rounded)).monospacedDigit()
                Text(t("kcal/day", "سعرة/يوم")).foregroundStyle(Theme.muted)
                Spacer()
                Chip(text: goalName(plan.effectiveGoal))
            }
            HStack(spacing: 8) {
                macro(t("Protein", "بروتين"), plan.proteinG, Theme.protein)
                macro(t("Carbs", "كربوهيدرات"), plan.carbsG, Theme.carbs)
                macro(t("Fat", "دهون"), plan.fatG, Theme.fat)
                macro(t("Fibre", "ألياف"), plan.fiberG, Theme.fiber)
            }
            VStack(alignment: .leading, spacing: 6) {
                row(t("Daily burn (maintenance)", "حرقك اليومي (الصيانة)"), "\(fmt(plan.maintenanceKcal)) • \(sourceName(plan.maintenanceSource))")
                row(t("Daily deficit/surplus", "العجز/الفائض اليومي"), signed(plan.dailyDeltaKcal))
                if let w = plan.weeklyChangeKg, w != 0 { row(t("Expected weekly change", "التغيّر المتوقع أسبوعياً"), signedKg(w)) }
                if let bmi = plan.bmi { row(t("BMI", "مؤشر كتلة الجسم"), fmt1(bmi)) }
                if let bd = plan.burnData, plan.maintenanceSource != "device" {
                    row(t("Burn data from your watch", "قياسات الحرق من الساعة"), t("\(bd.days) of \(bd.needed) days", "\(bd.days) من \(bd.needed) أيام"))
                }
            }
            ForEach(plan.notices, id: \.self) { Notice(text: $0.text, level: $0.level) }
        }
    }
    private func macro(_ label: String, _ g: Double, _ c: Color) -> some View {
        VStack(spacing: 2) {
            Text("\(fmt(g))").font(.headline).foregroundStyle(c).monospacedDigit()
            Text(t("\(label) g", "\(label) غ")).font(.caption2).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 8)
        .background(Theme.card2, in: RoundedRectangle(cornerRadius: 12))
    }
    private func row(_ k: String, _ v: String, ltr: Bool = false) -> some View {
        HStack {
            Text(k).foregroundStyle(Theme.muted)
            Spacer()
            Text(v).fontWeight(.semibold).monospacedDigit()
                .environment(\.layoutDirection, ltr ? .leftToRight : appLayoutDirection)
        }
        .font(.footnote)
    }
}

// MARK: Account & invites

struct AccountCard: View {
    @Environment(AppStore.self) private var store
    @State private var invites: [Invite]?
    @State private var linkEmail = ""
    @State private var linkPass = ""
    @State private var busy = false
    @State private var message: String?

    var body: some View {
        Card(title: t("My account", "حسابي"), icon: "person.crop.circle") {
            if let me = store.me {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(me.name ?? me.id).font(.headline)
                        Text(me.email ?? (me.role == "owner" ? t("Signed in with the owner key", "دخول بمفتاح المالك") : "")).font(.caption).foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    if me.role == "owner" { Chip(text: t("Owner", "المالك"), icon: "crown.fill", fg: Theme.warn, bg: Theme.accentSoft) }
                }
                if me.role == "owner" && me.account == false {
                    Divider()
                    Text(t("Link your email to sign in with a password instead of the key — your data stays as it is.", "اربط بريدك لتدخل بكلمة مرور بدل المفتاح — بياناتك الحالية تبقى كما هي.")).font(.caption).foregroundStyle(Theme.muted)
                    InputField(title: t("Email", "البريد الإلكتروني"), text: $linkEmail)
                        .textInputAutocapitalization(.never).keyboardType(.emailAddress)
                    SecureField(t("Password (at least 8 characters)", "كلمة المرور (8 أحرف على الأقل)"), text: $linkPass)
                        .padding(11).background(Theme.card2, in: RoundedRectangle(cornerRadius: 12))
                    Button(t("Link email", "ربط البريد")) { Task { await link() } }.buttonStyle(SoftButtonStyle()).disabled(busy)
                }
                if me.role == "owner" {
                    Divider()
                    HStack {
                        Text(t("Invite users", "دعوة مستخدمين")).font(.subheadline.weight(.semibold))
                        Spacer()
                        Button { Task { await createInvite() } } label: { Label(t("New code", "رمز جديد"), systemImage: "plus") }
                            .font(.subheadline).disabled(busy)
                    }
                    Text(t("Each code is for one person and valid for 14 days. User limits: 20 analyses and 12 coach requests per day.", "كل رمز لشخص واحد وصالح 14 يوماً. حدود المستخدم: 20 تحليل و12 طلب مدرب يومياً."))
                        .font(.caption).foregroundStyle(Theme.muted)
                    ForEach(invites ?? []) { inv in
                        HStack {
                            Text(inv.code).font(.system(.body, design: .monospaced).weight(.bold))
                                .environment(\.layoutDirection, .leftToRight)
                            Spacer()
                            if let used = inv.usedByName ?? inv.usedBy {
                                Text(t("Used: \(used)", "استُخدم: \(used)")).font(.caption).foregroundStyle(Theme.muted)
                            } else if inv.expiresAt < Date() {
                                Text(t("Expired", "منتهي")).font(.caption).foregroundStyle(Theme.bad)
                            } else {
                                ShareLink(item: t("Invite to NutriSnap 🍽️\nLink: \(APIClient.shared.baseURL.absoluteString)/app/\nInvite code: \(inv.code)", "دعوة لتطبيق NutriSnap 🍽️\nالرابط: \(APIClient.shared.baseURL.absoluteString)/app/\nرمز الدعوة: \(inv.code)")) {
                                    Image(systemName: "square.and.arrow.up")
                                }
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
            } else {
                ProgressView()
            }
            if let message { Text(message).font(.caption).foregroundStyle(Theme.muted) }
            Button(role: .destructive) { store.signOut() } label: { Text(t("Sign out", "تسجيل الخروج")).frame(maxWidth: .infinity) }
                .padding(.top, 4)
        }
        .task {
            if store.me == nil { store.me = try? await APIClient.shared.me() }
            if store.isOwner { invites = try? await APIClient.shared.invites() }
        }
    }

    private func link() async {
        busy = true; defer { busy = false }
        do {
            _ = try await APIClient.shared.register(inviteCode: nil, name: store.me?.name ?? t("Owner", "المالك"),
                                                    email: linkEmail.trimmingCharacters(in: .whitespaces), password: linkPass,
                                                    claimUserId: store.me?.id)
            message = t("Linked ✓ — you can now sign in with your email on any device", "تم الربط ✓ — يمكنك الآن الدخول بالبريد من أي جهاز")
            store.me = try? await APIClient.shared.me()
            linkPass = ""
        } catch { message = error.localizedDescription }
    }

    private func createInvite() async {
        busy = true; defer { busy = false }
        do {
            _ = try await APIClient.shared.createInvite()
            invites = try await APIClient.shared.invites()
        } catch { message = error.localizedDescription }
    }
}

// MARK: Devices

struct DevicesCard: View {
    @Environment(AppStore.self) private var store
    let profile: Profile?
    var onChange: () -> Void
    @State private var message: String?
    @State private var busy = false
    private let sources = [("", t("Automatic", "تلقائي")), ("whoop", "WHOOP"), ("apple_health", "Apple Health"), ("manual", t("Manual", "يدوي"))]

    var body: some View {
        Card(title: t("Devices & apps", "الأجهزة والتطبيقات"), icon: "applewatch") {
            Button {
                Task {
                    try? await HealthKitManager.shared.requestAuthorization()
                    await store.refresh(); message = t("Apple Health synced", "تمت مزامنة Apple Health")
                }
            } label: { Label(t("Apple Health — allow & sync", "Apple Health — سماح ومزامنة"), systemImage: "heart.fill") }
                .buttonStyle(SoftButtonStyle())

            if store.whoopConnected {
                HStack(spacing: 8) {
                    Button {
                        Task {
                            busy = true; defer { busy = false }
                            let from = Calendar.current.date(byAdding: .day, value: -3, to: Date())!
                            do { try await APIClient.shared.whoopSync(from: from, to: Date()); message = t("WHOOP synced", "تمت مزامنة WHOOP") }
                            catch { message = error.localizedDescription }
                            await store.refresh()
                        }
                    } label: { Label(t("Sync WHOOP", "مزامنة WHOOP"), systemImage: "arrow.triangle.2.circlepath") }
                        .buttonStyle(SoftButtonStyle()).disabled(busy)
                    Button(role: .destructive) {
                        Task { try? await APIClient.shared.whoopDisconnect(); store.setWhoop(false) }
                    } label: { Text(t("Disconnect", "فصل")) }
                        .frame(width: 60)
                }
            } else {
                Button { Task { await connectWhoop() } } label: { Label(t("Connect WHOOP", "ربط WHOOP"), systemImage: "link") }
                    .buttonStyle(SoftButtonStyle())
            }
            if let profile {
                HStack {
                    Text(t("Preferred burn source", "مصدر الحرق المفضل")).font(.subheadline)
                    Spacer()
                    Picker("", selection: Binding(
                        get: { profile.preferredEnergySource ?? "" },
                        set: { v in Task { _ = try? await APIClient.shared.updateProfile(["preferredEnergySource": v.isEmpty ? NSNull() as Any : v as Any]); onChange(); await store.refresh() } })) {
                        ForEach(sources, id: \.0) { Text($0.1).tag($0.0) }
                    }
                }
            }
            Text(t("When several sources cover the same day, only one is used so your burn isn't counted twice.", "عند توفر أكثر من مصدر لنفس اليوم يُستخدم مصدر واحد فقط لتجنب احتساب الحرق مرتين."))
                .font(.caption).foregroundStyle(Theme.muted)
            if let message { Text(message).font(.caption).foregroundStyle(Theme.brand2) }
        }
        .task { if let c = try? await APIClient.shared.whoopStatus() { store.setWhoop(c) } }
    }

    private func connectWhoop() async {
        do {
            let ok = try await WhoopConnector.shared.connect()
            store.setWhoop(ok)
            message = ok ? t("WHOOP connected ✓", "تم ربط WHOOP ✓") : t("Connection didn't finish", "لم يكتمل الربط")
            if ok { await store.refresh() }
        } catch { message = error.localizedDescription }
    }
}

// MARK: Ramadan settings

struct RamadanSettingsCard: View {
    let profile: Profile
    var onSaved: () -> Void
    @State private var enabled = false
    @State private var suhoor = Date()
    @State private var iftar = Date()
    @State private var loaded = false

    var body: some View {
        Card(title: t("Ramadan & fasting", "رمضان والصيام"), icon: "moon.stars") {
            Toggle(t("Fasting mode", "وضع الصيام"), isOn: $enabled)
            if enabled {
                DatePicker(t("Suhoor", "السحور"), selection: $suhoor, displayedComponents: .hourAndMinute)
                DatePicker(t("Iftar", "الإفطار"), selection: $iftar, displayedComponents: .hourAndMinute)
            }
            Text(t("Turns on automatically in Ramadan. You can turn it on for voluntary fasting days.", "يتفعّل تلقائياً في رمضان. يمكنك تفعيله لأيام الصيام التطوعي.")).font(.caption).foregroundStyle(Theme.muted)
            Button(t("Save", "حفظ")) { Task { await save() } }.buttonStyle(SoftButtonStyle())
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            enabled = profile.ramadan?.enabled ?? false
            suhoor = time(profile.ramadan?.suhoorTime ?? "04:45")
            iftar = time(profile.ramadan?.iftarTime ?? "18:00")
        }
    }

    private func time(_ hhmm: String) -> Date {
        let p = hhmm.split(separator: ":").compactMap { Int($0) }
        return Calendar.current.date(bySettingHour: p.first ?? 0, minute: p.count > 1 ? p[1] : 0, second: 0, of: Date()) ?? Date()
    }
    private func hhmm(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }
    private func save() async {
        // Off + never chosen = keep automatic detection during Ramadan.
        let flag: Any = enabled ? true as Any : (profile.ramadan?.enabled == nil ? NSNull() as Any : false as Any)
        let r: [String: Any] = ["enabled": flag, "suhoorTime": hhmm(suhoor), "iftarTime": hhmm(iftar)]
        _ = try? await APIClient.shared.updateProfile(["ramadan": r])
        onSaved()
    }
}
