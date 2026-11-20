import PhotosUI
import SwiftUI

struct CaptureView: View {
    @State private var image: UIImage?
    @State private var showCamera = false
    @State private var pickerItem: PhotosPickerItem?
    @State private var mealName = ""
    @State private var restaurant = ""
    @State private var portion = ""
    @State private var note = ""
    @State private var analyzing = false
    @State private var result: Meal?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if let image {
                        Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 280)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    HStack {
                        Button { showCamera = true } label: { Label("الكاميرا", systemImage: "camera.fill") }
                            .buttonStyle(.borderedProminent)
                            .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))
                        PhotosPicker(selection: $pickerItem, matching: .images) {
                            Label("من الصور", systemImage: "photo.on.rectangle")
                        }.buttonStyle(.bordered)
                    }
                }
                Section {
                    TextField("اسم الوجبة (اختياري)", text: $mealName)
                    TextField("المطعم (اختياري)", text: $restaurant)
                    TextField("الكمية — مثلاً: نصف، حجم كبير", text: $portion)
                    TextField("ملاحظة — مثلاً: بدون صوص", text: $note)
                } header: {
                    Text("معلومات تساعد الوكيل")
                } footer: {
                    Text("ذكر المطعم واسم الوجبة يسمح للوكيل بالبحث عن القيمة الغذائية المعلنة بدلاً من التقدير.")
                }
                Section {
                    Button {
                        Task { await analyze() }
                    } label: {
                        HStack {
                            Spacer()
                            if analyzing { ProgressView(); Text("  يحلل ويبحث...") } else { Text("احسب القيمة الغذائية").bold() }
                            Spacer()
                        }
                    }
                    .disabled(image == nil || analyzing)
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("صوّر وجبتك")
            .sheet(isPresented: $showCamera) { CameraPicker(image: $image).ignoresSafeArea() }
            .onChange(of: pickerItem) { _, item in
                Task {
                    if let data = try? await item?.loadTransferable(type: Data.self) { image = UIImage(data: data) }
                }
            }
            .navigationDestination(item: $result) { MealReviewView(meal: $0, onDone: reset) }
        }
    }

    private func analyze() async {
        guard let image else { return }
        analyzing = true; error = nil
        defer { analyzing = false }
        do {
            let r = try await APIClient.shared.analyze(image: image, mealName: mealName, restaurant: restaurant, portion: portion, note: note)
            result = r.meal
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func reset() {
        image = nil; pickerItem = nil; mealName = ""; restaurant = ""; portion = ""; note = ""; result = nil
    }
}

struct CameraPicker: UIViewControllerRepresentable {
    @Binding var image: UIImage?
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let p = UIImagePickerController()
        p.sourceType = .camera
        p.delegate = context.coordinator
        return p
    }
    func updateUIViewController(_ vc: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ p: CameraPicker) { parent = p }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            parent.image = info[.originalImage] as? UIImage
            parent.dismiss()
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}
