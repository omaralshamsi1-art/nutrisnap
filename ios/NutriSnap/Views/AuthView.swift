import SwiftUI

struct AuthView: View {
    @Environment(AppStore.self) private var store
    @State private var mode = 0 // 0 login, 1 register, 2 owner
    @State private var email = ""
    @State private var password = ""
    @State private var name = ""
    @State private var invite = ""
    @State private var ownerKey = ""
    @State private var ownerId = UserDefaults.standard.string(forKey: "devUserId") ?? "meera"
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                VStack(spacing: 10) {
                    Image("Logo")
                        .resizable().scaledToFit().frame(width: 84, height: 84)
                        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                    Text("NutriSnap").font(.largeTitle.bold()).foregroundStyle(Theme.brand)
                    Text("صوّر وجبتك… واعرف موقعك من هدفك").foregroundStyle(Theme.muted)
                }
                .padding(.top, 40)

                Picker("", selection: $mode) {
                    Text("دخول").tag(0)
                    Text("حساب جديد").tag(1)
                    Text("المالك").tag(2)
                }
                .pickerStyle(.segmented)

                Card {
                    VStack(spacing: 12) {
                        switch mode {
                        case 1:
                            field("رمز الدعوة", text: $invite, icon: "ticket")
                                .textInputAutocapitalization(.characters)
                            field("الاسم", text: $name, icon: "person")
                            field("البريد الإلكتروني", text: $email, icon: "envelope").keyboardType(.emailAddress)
                            secure("كلمة المرور (8 أحرف على الأقل)", text: $password)
                        case 2:
                            Text("للمالك فقط: مفتاح الخادم (API_KEY) من متغيرات Railway.")
                                .font(.footnote).foregroundStyle(Theme.muted)
                            secure("مفتاح الخادم", text: $ownerKey)
                            field("معرّف المستخدم", text: $ownerId, icon: "person.badge.key")
                        default:
                            field("البريد الإلكتروني", text: $email, icon: "envelope").keyboardType(.emailAddress)
                            secure("كلمة المرور", text: $password)
                        }
                    }
                }

                if let e = error ?? store.error { Notice(text: e, level: "danger") }

                Button { Task { await submit() } } label: {
                    if busy { ProgressView().tint(.white) } else { Text(mode == 1 ? "إنشاء الحساب" : "دخول") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy)

                if mode == 1 {
                    Text("التسجيل بالدعوة فقط — اطلب رمزاً من صاحب التطبيق.")
                        .font(.footnote).foregroundStyle(Theme.muted)
                }
                ServerField()
            }
            .padding(20)
        }
        .screenBackground()
    }

    private func submit() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            switch mode {
            case 1:
                let r = try await APIClient.shared.register(inviteCode: invite.trimmingCharacters(in: .whitespaces).uppercased(),
                                                            name: name, email: email.trimmingCharacters(in: .whitespaces), password: password)
                store.signIn(token: r.token, user: r.user)
            case 2:
                let key = ownerKey.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !key.isEmpty else { error = "أدخل مفتاح الخادم"; return }
                store.signInOwner(apiKey: key, userId: ownerId.trimmingCharacters(in: .whitespaces))
                do { store.me = try await APIClient.shared.me() } catch {
                    store.signOut(); self.error = "المفتاح غير صحيح"; return
                }
            default:
                let r = try await APIClient.shared.login(email: email.trimmingCharacters(in: .whitespaces), password: password)
                store.signIn(token: r.token, user: r.user)
            }
            store.error = nil
            await store.refresh()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func field(_ title: String, text: Binding<String>, icon: String) -> some View {
        HStack {
            Image(systemName: icon).foregroundStyle(Theme.muted).frame(width: 22)
            TextField(title, text: text).textInputAutocapitalization(.never).autocorrectionDisabled()
        }
        .padding(12)
        .background(Theme.card2, in: RoundedRectangle(cornerRadius: 12))
    }

    private func secure(_ title: String, text: Binding<String>) -> some View {
        HStack {
            Image(systemName: "lock").foregroundStyle(Theme.muted).frame(width: 22)
            SecureField(title, text: text)
        }
        .padding(12)
        .background(Theme.card2, in: RoundedRectangle(cornerRadius: 12))
    }
}

/// Advanced: change the server address (defaults to the Railway URL in Info.plist).
struct ServerField: View {
    @AppStorage("apiBaseURL") private var apiBaseURL = ""
    @State private var open = false
    var body: some View {
        DisclosureGroup(isExpanded: $open) {
            TextField("https://…", text: $apiBaseURL)
                .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                .padding(10).background(Theme.card2, in: RoundedRectangle(cornerRadius: 10))
            Text("اتركه فارغاً لاستخدام الخادم الافتراضي.").font(.caption).foregroundStyle(Theme.muted)
        } label: {
            Text("إعدادات الخادم").font(.footnote).foregroundStyle(Theme.muted)
        }
    }
}
