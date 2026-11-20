import SwiftUI

struct SettingsView: View {
    @Environment(AppStore.self) private var store
    @AppStorage("apiBaseURL") private var apiBaseURL = ""
    @AppStorage("accessToken") private var accessToken = ""
    @AppStorage("devUserId") private var devUserId = "local-user"

    @State private var profile: Profile?
    @State private var message: String?
    @State private var busy = false

    private let activity = [("sedentary", "خامل"), ("light", "نشاط خفيف"), ("moderate", "متوسط"), ("active", "نشيط"), ("very_active", "نشيط جداً")]
    private let goals = [("lose", "إنقاص الوزن"), ("maintain", "المحافظة"), ("gain", "زيادة")]
    private let sources = [("", "تلقائي"), ("whoop", "WHOOP"), ("apple_health", "Apple Health"), ("manual", "يدوي")]

    var body: some View {
        NavigationStack {
            Form {
                if let p = Binding($profile) {
                    Section("ملفك (لتقدير الحرق عند عدم وجود جهاز)") {
                        Picker("الجنس", selection: p.sex) {
                            Text("—").tag(String?.none); Text("ذكر").tag(String?("male")); Text("أنثى").tag(String?("female"))
                        }
                        intField("سنة الميلاد", p.birthYear)
                        dblField("الطول (سم)", p.heightCm)
                        dblField("الوزن (كغ)", p.weightKg)
                        Picker("مستوى النشاط", selection: p.activityLevel) { ForEach(activity, id: \.0) { Text($0.1).tag($0.0) } }
                    }
                    Section("الهدف") {
                        Picker("الهدف", selection: p.goal) { ForEach(goals, id: \.0) { Text($0.1).tag($0.0) } }
                        Stepper("الفرق اليومي: \(Int(p.wrappedValue.goalDeltaKcal)) سعرة", value: p.goalDeltaKcal, in: -1000...1000, step: 50)
                        Picker("مصدر الحرق المفضل", selection: Binding(
                            get: { p.wrappedValue.preferredEnergySource ?? "" },
                            set: { p.wrappedValue.preferredEnergySource = $0.isEmpty ? nil : $0 })) {
                            ForEach(sources, id: \.0) { Text($0.1).tag($0.0) }
                        }
                        Button("حفظ الملف") { Task { await save() } }.disabled(busy)
                    }
                }

                Section {
                    Button("السماح بالوصول إلى Apple Health") {
                        Task {
                            try? await HealthKitManager.shared.requestAuthorization()
                            await store.refresh()
                            message = "تمت مزامنة Apple Health"
                        }
                    }
                    if store.whoopConnected {
                        Button("مزامنة WHOOP الآن") {
                            Task { await store.refresh(); message = "تمت مزامنة WHOOP" }
                        }
                        Button("فصل WHOOP", role: .destructive) {
                            Task { try? await APIClient.shared.whoopDisconnect(); store.setWhoop(false) }
                        }
                    } else {
                        Button("ربط WHOOP") { Task { await connectWhoop() } }
                    }
                } header: { Text("الأجهزة والتطبيقات") } footer: {
                    Text("عند توفر أكثر من مصدر لنفس اليوم يُستخدم مصدر واحد فقط لتجنب احتساب الحرق مرتين. Garmin و Fitbit وغيرها يمكن ربطها عبر Apple Health أو عبر واجهة /energy/samples.")
                }

                Section("الخادم") {
                    TextField("عنوان الخادم", text: $apiBaseURL, prompt: Text("http://localhost:3000"))
                        .textInputAutocapitalization(.never).keyboardType(.URL)
                    SecureField("رمز الدخول (Supabase)", text: $accessToken)
                    TextField("معرّف المستخدم (وضع التطوير)", text: $devUserId).textInputAutocapitalization(.never)
                }
                if let message { Section { Text(message) } }
            }
            .navigationTitle("الإعدادات")
            .task { await load() }
        }
    }

    private func load() async {
        profile = try? await APIClient.shared.profile()
        if let connected = try? await APIClient.shared.whoopStatus() { store.setWhoop(connected) }
    }

    private func save() async {
        guard let p = profile else { return }
        busy = true; defer { busy = false }
        do { profile = try await APIClient.shared.saveProfile(p); message = "تم الحفظ"; await store.refresh() }
        catch { message = error.localizedDescription }
    }

    private func connectWhoop() async {
        do {
            let ok = try await WhoopConnector.shared.connect()
            store.setWhoop(ok)
            message = ok ? "تم ربط WHOOP" : "لم يكتمل الربط"
            if ok { await store.refresh() }
        } catch { message = error.localizedDescription }
    }

    private func intField(_ label: String, _ v: Binding<Int?>) -> some View {
        HStack { Text(label); Spacer()
            TextField(label, value: v, format: .number.grouping(.never)).keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(width: 100) }
    }
    private func dblField(_ label: String, _ v: Binding<Double?>) -> some View {
        HStack { Text(label); Spacer()
            TextField(label, value: v, format: .number).keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 100) }
    }
}
