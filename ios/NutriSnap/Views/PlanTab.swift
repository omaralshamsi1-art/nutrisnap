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
                    Card(title: "التذكيرات", icon: "bell.badge") {
                        Text("التذكيرات الذكية (موعد الوجبة المعتاد ووزن الصباح) تعمل حالياً من تطبيق الويب بعد إضافته للشاشة الرئيسية.")
                            .font(.footnote).foregroundStyle(Theme.muted)
                    }
                    if let message { Text(message).font(.footnote).foregroundStyle(Theme.muted) }
                    Text("NutriSnap \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")")
                        .font(.caption2).foregroundStyle(Theme.muted)
                }
                .padding(16)
            }
            .screenBackground()
            .navigationTitle("الخطة")
            .refreshable { await load() }
            .task { await load() }
            .sheet(isPresented: $editing, onDismiss: { Task { await load(); await store.refresh() } }) {
                OnboardingView(existing: profile).environment(store).environment(\.layoutDirection, .rightToLeft)
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
        Card(title: "خطتك اليومية", icon: "target",
             trailing: AnyView(Button("تعديل", action: onEdit).font(.subheadline.weight(.semibold)))) {
            HStack(alignment: .firstTextBaseline) {
                Text(fmt(plan.targetKcal)).font(.system(size: 40, weight: .bold, design: .rounded)).monospacedDigit()
                Text("سعرة/يوم").foregroundStyle(Theme.muted)
                Spacer()
                Chip(text: goalName(plan.effectiveGoal))
            }
            HStack(spacing: 8) {
                macro("بروتين", plan.proteinG, Theme.protein)
                macro("كربوهيدرات", plan.carbsG, Theme.carbs)
                macro("دهون", plan.fatG, Theme.fat)
                macro("ألياف", plan.fiberG, Theme.fiber)
            }
            VStack(alignment: .leading, spacing: 6) {
                row("حرقك اليومي (الصيانة)", "\(fmt(plan.maintenanceKcal)) • \(sourceName(plan.maintenanceSource))")
                row("العجز/الفائض اليومي", signed(plan.dailyDeltaKcal), ltr: true)
                if let w = plan.weeklyChangeKg, w != 0 { row("التغيّر المتوقع أسبوعياً", "\(w > 0 ? "+" : "−")\(fmt1(abs(w))) كغ", ltr: true) }
                if let bmi = plan.bmi { row("مؤشر كتلة الجسم", fmt1(bmi)) }
                if let bd = plan.burnData, plan.maintenanceSource != "device" {
                    row("قياسات الحرق من الساعة", "\(bd.days) من \(bd.needed) أيام")
                }
            }
            ForEach(plan.notices, id: \.self) { Notice(text: $0.textAr, level: $0.level) }
        }
    }
    private func macro(_ t: String, _ g: Double, _ c: Color) -> some View {
        VStack(spacing: 2) {
            Text("\(fmt(g))").font(.headline).foregroundStyle(c).monospacedDigit()
            Text("\(t) غ").font(.caption2).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 8)
        .background(Theme.card2, in: RoundedRectangle(cornerRadius: 12))
    }
    private func row(_ k: String, _ v: String, ltr: Bool = false) -> some View {
        HStack {
            Text(k).foregroundStyle(Theme.muted)
            Spacer()
            Text(v).fontWeight(.semibold).monospacedDigit()
                .environment(\.layoutDirection, ltr ? .leftToRight : .rightToLeft)
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
        Card(title: "حسابي", icon: "person.crop.circle") {
            if let me = store.me {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(me.name ?? me.id).font(.headline)
                        Text(me.email ?? (me.role == "owner" ? "دخول بمفتاح المالك" : "")).font(.caption).foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    if me.role == "owner" { Chip(text: "المالك", icon: "crown.fill", fg: Theme.warn, bg: Theme.accentSoft) }
                }
                if me.role == "owner" && me.account == false {
                    Divider()
                    Text("اربط بريدك لتدخل بكلمة مرور بدل المفتاح — بياناتك الحالية تبقى كما هي.").font(.caption).foregroundStyle(Theme.muted)
                    InputField(title: "البريد الإلكتروني", text: $linkEmail)
                        .textInputAutocapitalization(.never).keyboardType(.emailAddress)
                    SecureField("كلمة المرور (8 أحرف على الأقل)", text: $linkPass)
                        .padding(11).background(Theme.card2, in: RoundedRectangle(cornerRadius: 12))
                    Button("ربط البريد") { Task { await link() } }.buttonStyle(SoftButtonStyle()).disabled(busy)
                }
                if me.role == "owner" {
                    Divider()
                    HStack {
                        Text("دعوة مستخدمين").font(.subheadline.weight(.semibold))
                        Spacer()
                        Button { Task { await createInvite() } } label: { Label("رمز جديد", systemImage: "plus") }
                            .font(.subheadline).disabled(busy)
                    }
                    Text("كل رمز لشخص واحد وصالح 14 يوماً. حدود المستخدم: 20 تحليل و12 طلب مدرب يومياً.")
                        .font(.caption).foregroundStyle(Theme.muted)
                    ForEach(invites ?? []) { inv in
                        HStack {
                            Text(inv.code).font(.system(.body, design: .monospaced).weight(.bold))
                                .environment(\.layoutDirection, .leftToRight)
                            Spacer()
                            if let used = inv.usedByName ?? inv.usedBy {
                                Text("استُخدم: \(used)").font(.caption).foregroundStyle(Theme.muted)
                            } else if inv.expiresAt < Date() {
                                Text("منتهي").font(.caption).foregroundStyle(Theme.bad)
                            } else {
                                ShareLink(item: "دعوة لتطبيق NutriSnap 🍽️\nالرابط: \(APIClient.shared.baseURL.absoluteString)/app/\nرمز الدعوة: \(inv.code)") {
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
            Button(role: .destructive) { store.signOut() } label: { Text("تسجيل الخروج").frame(maxWidth: .infinity) }
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
            _ = try await APIClient.shared.register(inviteCode: nil, name: store.me?.name ?? "المالك",
                                                    email: linkEmail.trimmingCharacters(in: .whitespaces), password: linkPass,
                                                    claimUserId: store.me?.id)
            message = "تم الربط ✓ — يمكنك الآن الدخول بالبريد من أي جهاز"
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
    private let sources = [("", "تلقائي"), ("whoop", "WHOOP"), ("apple_health", "Apple Health"), ("manual", "يدوي")]

    var body: some View {
        Card(title: "الأجهزة والتطبيقات", icon: "applewatch") {
            Button {
                Task {
                    try? await HealthKitManager.shared.requestAuthorization()
                    await store.refresh(); message = "تمت مزامنة Apple Health"
                }
            } label: { Label("Apple Health — سماح ومزامنة", systemImage: "heart.fill") }
                .buttonStyle(SoftButtonStyle())

            if store.whoopConnected {
                HStack(spacing: 8) {
                    Button {
                        Task {
                            busy = true; defer { busy = false }
                            let from = Calendar.current.date(byAdding: .day, value: -3, to: Date())!
                            do { try await APIClient.shared.whoopSync(from: from, to: Date()); message = "تمت مزامنة WHOOP" }
                            catch { message = error.localizedDescription }
                            await store.refresh()
                        }
                    } label: { Label("مزامنة WHOOP", systemImage: "arrow.triangle.2.circlepath") }
                        .buttonStyle(SoftButtonStyle()).disabled(busy)
                    Button(role: .destructive) {
                        Task { try? await APIClient.shared.whoopDisconnect(); store.setWhoop(false) }
                    } label: { Text("فصل") }
                        .frame(width: 60)
                }
            } else {
                Button { Task { await connectWhoop() } } label: { Label("ربط WHOOP", systemImage: "link") }
                    .buttonStyle(SoftButtonStyle())
            }
            if let profile {
                HStack {
                    Text("مصدر الحرق المفضل").font(.subheadline)
                    Spacer()
                    Picker("", selection: Binding(
                        get: { profile.preferredEnergySource ?? "" },
                        set: { v in Task { _ = try? await APIClient.shared.updateProfile(["preferredEnergySource": v.isEmpty ? NSNull() as Any : v as Any]); onChange(); await store.refresh() } })) {
                        ForEach(sources, id: \.0) { Text($0.1).tag($0.0) }
                    }
                }
            }
            Text("عند توفر أكثر من مصدر لنفس اليوم يُستخدم مصدر واحد فقط لتجنب احتساب الحرق مرتين.")
                .font(.caption).foregroundStyle(Theme.muted)
            if let message { Text(message).font(.caption).foregroundStyle(Theme.brand2) }
        }
        .task { if let c = try? await APIClient.shared.whoopStatus() { store.setWhoop(c) } }
    }

    private func connectWhoop() async {
        do {
            let ok = try await WhoopConnector.shared.connect()
            store.setWhoop(ok)
            message = ok ? "تم ربط WHOOP ✓" : "لم يكتمل الربط"
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
        Card(title: "رمضان والصيام", icon: "moon.stars") {
            Toggle("وضع الصيام", isOn: $enabled)
            if enabled {
                DatePicker("السحور", selection: $suhoor, displayedComponents: .hourAndMinute)
                DatePicker("الإفطار", selection: $iftar, displayedComponents: .hourAndMinute)
            }
            Text("يتفعّل تلقائياً في رمضان. يمكنك تفعيله لأيام الصيام التطوعي.").font(.caption).foregroundStyle(Theme.muted)
            Button("حفظ") { Task { await save() } }.buttonStyle(SoftButtonStyle())
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
        let flag: Any = enabled ? true : (profile.ramadan?.enabled == nil ? NSNull() : false)
        let r: [String: Any] = ["enabled": flag, "suhoorTime": hhmm(suhoor), "iftarTime": hhmm(iftar)]
        _ = try? await APIClient.shared.updateProfile(["ramadan": r])
        onSaved()
    }
}
