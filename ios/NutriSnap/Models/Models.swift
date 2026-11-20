import Foundation

struct Nutrients: Codable, Hashable {
    var calories: Double = 0
    var proteinG: Double = 0
    var carbsG: Double = 0
    var fatG: Double = 0
    var fiberG: Double = 0
    var sugarG: Double = 0
    var sodiumMg: Double = 0

    enum CodingKeys: String, CodingKey {
        case calories
        case proteinG = "protein_g", carbsG = "carbs_g", fatG = "fat_g"
        case fiberG = "fiber_g", sugarG = "sugar_g", sodiumMg = "sodium_mg"
    }
}

struct MealItem: Codable, Hashable, Identifiable {
    var id = UUID()
    var name: String
    var nameAr: String
    var quantity: Double
    var unit: String
    var grams: Double?
    var calories: Double
    var proteinG: Double
    var carbsG: Double
    var fatG: Double
    var fiberG: Double
    var sugarG: Double
    var sodiumMg: Double

    enum CodingKeys: String, CodingKey {
        case name, quantity, unit, grams, calories
        case nameAr = "name_ar"
        case proteinG = "protein_g", carbsG = "carbs_g", fatG = "fat_g"
        case fiberG = "fiber_g", sugarG = "sugar_g", sodiumMg = "sodium_mg"
    }

    static func blank() -> MealItem {
        MealItem(name: "Item", nameAr: "صنف", quantity: 1, unit: "serving", grams: nil,
                 calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sugarG: 0, sodiumMg: 0)
    }
}

struct SourceRef: Codable, Hashable { var title: String; var url: String }

enum NutritionSource: String, Codable {
    case restaurantPublished = "restaurant_published"
    case knownMeal = "known_meal"
    case database
    case estimate

    var labelAr: String {
        switch self {
        case .restaurantPublished: return "قيمة معلنة من المطعم"
        case .knownMeal: return "من وجباتك السابقة"
        case .database: return "قاعدة بيانات غذائية"
        case .estimate: return "تقدير تقريبي من الصورة"
        }
    }
}

struct NutritionEstimate: Codable, Hashable {
    var mealName: String
    var mealNameAr: String
    var restaurant: String?
    var source: NutritionSource
    var confidence: Double
    var servingDescription: String
    var items: [MealItem]
    var totals: Nutrients
    var sources: [SourceRef]
    var assumptions: [String]
    var warnings: [String]

    enum CodingKeys: String, CodingKey {
        case restaurant, source, confidence, items, totals, sources, assumptions, warnings
        case mealName = "meal_name", mealNameAr = "meal_name_ar", servingDescription = "serving_description"
    }
}

struct Meal: Codable, Identifiable, Hashable {
    let id: String
    var eatenAt: Date
    var date: String
    var status: String
    var estimate: NutritionEstimate
    var final: NutritionEstimate
    var edited: Bool
    var isConfirmed: Bool { status == "confirmed" }
}

struct AnalyzeResponse: Codable {
    struct AgentInfo: Codable { let model: String; let searchesUsed: Int }
    let meal: Meal
    let agent: AgentInfo
}

struct Balance: Codable {
    struct Burn: Codable { let source: String; let totalKcal: Double; let activeKcal: Double?; let basalKcal: Double? }
    struct MealRow: Codable, Identifiable {
        let id: String; let eatenAt: Date; let status: String
        let name: String; let nameAr: String; let restaurant: String?; let source: String; let calories: Double
        enum CodingKeys: String, CodingKey { case id, eatenAt, status, name, restaurant, source, calories; case nameAr = "name_ar" }
    }
    struct Split: Codable { let protein: Int; let carbs: Int; let fat: Int }
    let date: String
    let intake: Nutrients
    let pendingDrafts: Nutrients
    let burn: Burn?
    let burnIsPartialDay: Bool
    let estimatedTdee: Double?
    let goal: String
    let targetIntakeKcal: Double?
    let remainingKcal: Double?
    let netKcal: Double?
    let macroSplitPct: Split
    let meals: [MealRow]
}

struct Profile: Codable {
    var sex: String?
    var birthYear: Int?
    var heightCm: Double?
    var weightKg: Double?
    var activityLevel: String
    var goal: String
    var goalDeltaKcal: Double
    var preferredEnergySource: String?
    var timezone: String
    var city: String?
    var country: String?
}

struct EnergySample: Codable {
    let date: String
    let source: String
    var activeKcal: Double?
    var basalKcal: Double?
    var totalKcal: Double?
}

extension DateFormatter {
    static let isoDay: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}
