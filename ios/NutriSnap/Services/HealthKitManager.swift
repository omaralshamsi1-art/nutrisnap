import Foundation
import HealthKit

/// Apple Health integration:
/// - READ active + basal energy burned → pushed to the backend as the day's burn
/// - WRITE confirmed meals as an HKCorrelation(.food) so they appear in Health and in apps that read it
@MainActor
final class HealthKitManager {
    static let shared = HealthKitManager()
    private let store = HKHealthStore()

    private let readTypes: Set<HKObjectType> = [
        HKQuantityType(.activeEnergyBurned),
        HKQuantityType(.basalEnergyBurned),
        HKQuantityType(.bodyMass),
        HKQuantityType(.height),
    ]

    private let dietary: [(KeyPath<Nutrients, Double>, HKQuantityTypeIdentifier, HKUnit)] = [
        (\.calories, .dietaryEnergyConsumed, .kilocalorie()),
        (\.proteinG, .dietaryProtein, .gram()),
        (\.carbsG, .dietaryCarbohydrates, .gram()),
        (\.fatG, .dietaryFatTotal, .gram()),
        (\.fiberG, .dietaryFiber, .gram()),
        (\.sugarG, .dietarySugar, .gram()),
        (\.sodiumMg, .dietarySodium, .gramUnit(with: .milli)),
    ]

    var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    func requestAuthorization() async throws {
        guard isAvailable else { return }
        let share = Set(dietary.map { HKQuantityType($0.1) as HKSampleType })
        try await store.requestAuthorization(toShare: share, read: readTypes.union(share.map { $0 as HKObjectType }))
    }

    // MARK: Burn

    func energy(on day: Date) async throws -> (active: Double, basal: Double) {
        let start = Calendar.current.startOfDay(for: day)
        let end = min(Calendar.current.date(byAdding: .day, value: 1, to: start)!, Date())
        async let a = sum(.activeEnergyBurned, start, end)
        async let b = sum(.basalEnergyBurned, start, end)
        return try await (a, b)
    }

    private func sum(_ id: HKQuantityTypeIdentifier, _ start: Date, _ end: Date) async throws -> Double {
        let predicate = HKSamplePredicate.quantitySample(
            type: HKQuantityType(id),
            predicate: HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate))
        let query = HKStatisticsQueryDescriptor(predicate: predicate, options: .cumulativeSum)
        return try await query.result(for: store)?.sumQuantity()?.doubleValue(for: .kilocalorie()) ?? 0
    }

    /// Reads the last `days` days of burn and sends them to the backend.
    func syncBurnToServer(days: Int = 2) async {
        guard isAvailable else { return }
        var samples: [EnergySample] = []
        for offset in 0..<days {
            let day = Calendar.current.date(byAdding: .day, value: -offset, to: Date())!
            guard let e = try? await energy(on: day), e.active + e.basal > 0 else { continue }
            samples.append(EnergySample(date: DateFormatter.isoDay.string(from: day), source: "apple_health",
                                        activeKcal: e.active.rounded(), basalKcal: e.basal.rounded(), totalKcal: nil))
        }
        if !samples.isEmpty { try? await APIClient.shared.pushEnergy(samples) }
    }

    /// Wakes the app when new active energy is written (watch workouts etc.) and re-syncs.
    func enableBackgroundSync() {
        guard isAvailable else { return }
        let type = HKQuantityType(.activeEnergyBurned)
        let query = HKObserverQuery(sampleType: type, predicate: nil) { _, completion, error in
            guard error == nil else { completion(); return }
            Task { @MainActor in
                await HealthKitManager.shared.syncBurnToServer(days: 1)
                completion()
            }
        }
        store.execute(query)
        store.enableBackgroundDelivery(for: type, frequency: .hourly) { _, _ in }
    }

    // MARK: Meals → Health

    func save(meal: Meal) async throws {
        guard isAvailable else { return }
        try await delete(mealId: meal.id) // idempotent re-save after edits
        let t = meal.final.totals
        let meta: [String: Any] = [
            HKMetadataKeyFoodType: meal.final.mealNameAr.isEmpty ? meal.final.mealName : meal.final.mealNameAr,
            HKMetadataKeyExternalUUID: meal.id,
        ]
        var samples = Set<HKSample>()
        for (keyPath, id, unit) in dietary {
            let value = t[keyPath: keyPath]
            guard value > 0 else { continue }
            // units match the backend: kcal, g, and mg for sodium
            samples.insert(HKQuantitySample(type: HKQuantityType(id), quantity: HKQuantity(unit: unit, doubleValue: value),
                                            start: meal.eatenAt, end: meal.eatenAt, metadata: meta))
        }
        guard !samples.isEmpty else { return }
        let food = HKCorrelation(type: HKCorrelationType(.food), start: meal.eatenAt, end: meal.eatenAt,
                                 objects: samples, metadata: meta)
        try await store.save(food)
    }

    func delete(mealId: String) async throws {
        guard isAvailable else { return }
        let predicate = HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeyExternalUUID, allowedValues: [mealId])
        let query = HKSampleQueryDescriptor(
            predicates: [.sample(type: HKCorrelationType(.food), predicate: predicate)], sortDescriptors: [])
        let found = try await query.result(for: store)
        let objects: [HKObject] = found.flatMap { s -> [HKObject] in
            guard let c = s as? HKCorrelation else { return [s] }
            return Array(c.objects) + [c]
        }
        if !objects.isEmpty { try await store.delete(objects) }
    }
}
