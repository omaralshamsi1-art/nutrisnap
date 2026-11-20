import SwiftUI

/// Shows the agent's result and lets the user correct anything before confirming.
struct MealReviewView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State var meal: Meal
    var onDone: (() -> Void)? = nil

    @State private var items: [MealItem] = []
    @State private var mealName = ""
    @State private var restaurant = ""
    @State private var portion = 1.0
    @State private var busy = false
    @State private var error: String?

    private var dirty: Bool {
        items != meal.final.items || mealName != meal.final.mealNameAr || restaurant != (meal.final.restaurant ?? "") || portion != 1
    }
    private var liveTotals: Nutrients {
        items.reduce(into: Nutrients()) { t, i in
            t.calories += i.calories * portion; t.proteinG += i.proteinG * portion
            t.carbsG += i.carbsG * portion; t.fatG += i.fatG * portion; t.fiberG += i.fiberG * portion
            t.sugarG += i.sugarG * portion; t.sodiumMg += i.sodiumMg * portion
        }
    }

    var body: some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    TextField("اسم الوجبة", text: $mealName).font(.title3.bold())
                    TextField("المطعم", text: $restaurant).foregroundStyle(.secondary)
                    HStack {
                        SourceBadge(source: meal.final.source, confidence: meal.final.confidence)
                        Spacer()
                        Text(meal.final.servingDescription).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            Section("الإجمالي") {
                HStack {
                    Text("\(Int(liveTotals.calories))").font(.system(size: 34, weight: .bold)).monospacedDigit()
                    Text("سعرة")
                    Spacer()
                }
                MacroBar(n: liveTotals)
                VStack(alignment: .leading) {
                    Text("الكمية التي أكلتها: \(portion, format: .percent.precision(.fractionLength(0)))")
                    Slider(value: $portion, in: 0.25...2, step: 0.25)
                }
            }
            Section {
                ForEach($items) { $item in ItemEditor(item: $item) }
                    .onDelete { items.remove(atOffsets: $0) }
                Button { items.append(.blank()) } label: { Label("إضافة صنف", systemImage: "plus") }
            } header: { Text("المكونات (اضغط للتعديل)") }

            if !meal.final.assumptions.isEmpty {
                Section("افتراضات الوكيل — عدّل إذا لم تكن صحيحة") {
                    ForEach(meal.final.assumptions, id: \.self) { Text("• \($0)").font(.callout) }
                }
            }
            if !meal.final.warnings.isEmpty {
                Section("تنبيهات") {
                    ForEach(meal.final.warnings, id: \.self) { Text($0).font(.callout).foregroundStyle(.orange) }
                }
            }
            if !meal.final.sources.isEmpty {
                Section("المصادر") {
                    ForEach(meal.final.sources, id: \.url) { s in
                        if let u = URL(string: s.url) { Link(s.title, destination: u).lineLimit(1) }
                    }
                }
            }
            if let error { Section { Text(error).foregroundStyle(.red) } }

            Section {
                Button { Task { await confirm() } } label: {
                    HStack { Spacer(); if busy { ProgressView() } else { Text(meal.isConfirmed ? "حفظ التعديلات" : "تأكيد وإضافة لليوم").bold() }; Spacer() }
                }.disabled(busy || items.isEmpty)
                Button(role: .destructive) { Task { await remove() } } label: { HStack { Spacer(); Text("حذف الوجبة"); Spacer() } }
            }
        }
        .navigationTitle("مراجعة الوجبة")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            items = meal.final.items
            mealName = meal.final.mealNameAr
            restaurant = meal.final.restaurant ?? ""
        }
    }

    private func confirm() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            if dirty {
                // The user edits the Arabic name; the English name is kept unless the meal has none.
                meal = try await APIClient.shared.updateMeal(
                    id: meal.id, items: items,
                    mealName: meal.final.mealName.isEmpty ? mealName : nil,
                    mealNameAr: mealName,
                    restaurant: restaurant.isEmpty ? nil : restaurant,
                    portionFactor: portion == 1 ? nil : portion)
            }
            meal = try await APIClient.shared.confirmMeal(id: meal.id)
            try? await HealthKitManager.shared.save(meal: meal)
            await store.refresh()
            onDone?()
            dismiss()
        } catch { self.error = error.localizedDescription }
    }

    private func remove() async {
        busy = true
        defer { busy = false }
        do {
            try await APIClient.shared.deleteMeal(id: meal.id)
            try? await HealthKitManager.shared.delete(mealId: meal.id)
            await store.refresh()
            onDone?()
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

struct ItemEditor: View {
    @Binding var item: MealItem
    @State private var expanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            TextField("الاسم", text: $item.nameAr)
            HStack {
                num("الكمية", $item.quantity)
                TextField("الوحدة", text: $item.unit)
            }
            num("الوزن (غ)", Binding(get: { item.grams ?? 0 }, set: { item.grams = $0 > 0 ? $0 : nil }))
            num("السعرات", $item.calories)
            num("بروتين (غ)", $item.proteinG)
            num("كربوهيدرات (غ)", $item.carbsG)
            num("دهون (غ)", $item.fatG)
            num("ألياف (غ)", $item.fiberG)
            num("سكر (غ)", $item.sugarG)
            num("صوديوم (ملغ)", $item.sodiumMg)
        } label: {
            HStack {
                VStack(alignment: .leading) {
                    Text(item.nameAr.isEmpty ? item.name : item.nameAr)
                    Text("\(item.quantity.formatted()) \(item.unit)\(item.grams.map { " • \(Int($0)) غ" } ?? "")")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Text("\(Int(item.calories))").monospacedDigit()
            }
        }
    }

    private func num(_ label: String, _ value: Binding<Double>) -> some View {
        HStack {
            Text(label)
            Spacer()
            TextField(label, value: value, format: .number.precision(.fractionLength(0...1)))
                .keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 90)
        }
    }
}

struct SourceBadge: View {
    let source: NutritionSource
    let confidence: Double
    private var color: Color {
        switch source {
        case .restaurantPublished, .knownMeal: return .green
        case .database: return .blue
        case .estimate: return .orange
        }
    }
    var body: some View {
        Text("\(source.labelAr) • ثقة \(Int(confidence * 100))٪")
            .font(.caption.bold()).padding(.horizontal, 8).padding(.vertical, 4)
            .background(color.opacity(0.15), in: Capsule()).foregroundStyle(color)
    }
}
