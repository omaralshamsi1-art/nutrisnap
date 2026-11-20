import Foundation
import UIKit

enum APIError: LocalizedError {
    case http(Int, String)
    var errorDescription: String? {
        switch self { case let .http(code, msg): return "خطأ من الخادم (\(code)): \(msg)" }
    }
}

/// Talks to the NutriSnap backend. Auth: Supabase access token (Bearer) in production,
/// or X-User-Id when the server runs with AUTH_MODE=dev.
final class APIClient {
    static let shared = APIClient()

    var baseURL: URL {
        let stored = UserDefaults.standard.string(forKey: "apiBaseURL")
        let fallback = Bundle.main.object(forInfoDictionaryKey: "NutriSnapAPIBaseURL") as? String ?? "http://localhost:3000"
        return URL(string: (stored?.isEmpty == false ? stored! : fallback))!
    }
    var accessToken: String? { UserDefaults.standard.string(forKey: "accessToken").flatMap { $0.isEmpty ? nil : $0 } }
    var devUserId: String { UserDefaults.standard.string(forKey: "devUserId") ?? "local-user" }
    var apiKey: String? { UserDefaults.standard.string(forKey: "apiKey").flatMap { $0.isEmpty ? nil : $0 } }

    private let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 120 // agent may search the web
        return URLSession(configuration: c)
    }()

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        let withFrac = ISO8601DateFormatter(); withFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        d.dateDecodingStrategy = .custom { dec in
            let s = try dec.singleValueContainer().decode(String.self)
            if let date = withFrac.date(from: s) ?? plain.date(from: s) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: dec.codingPath, debugDescription: "Bad date \(s)"))
        }
        return d
    }()
    private let encoder = JSONEncoder()

    // MARK: Meals

    func analyze(image: UIImage, mealName: String?, restaurant: String?, portion: String?, note: String?) async throws -> AnalyzeResponse {
        guard let jpeg = image.resizedForUpload().jpegData(compressionQuality: 0.8) else { throw APIError.http(0, "image") }
        var form = MultipartForm()
        form.addFile(name: "photo", filename: "meal.jpg", mime: "image/jpeg", data: jpeg)
        for (k, v) in [("mealName", mealName), ("restaurant", restaurant), ("portion", portion), ("note", note)] {
            if let v, !v.trimmingCharacters(in: .whitespaces).isEmpty { form.addField(name: k, value: v) }
        }
        form.addField(name: "eatenAt", value: ISO8601DateFormatter().string(from: Date()))
        var req = request("meals/analyze", method: "POST")
        req.setValue(form.contentType, forHTTPHeaderField: "Content-Type")
        req.httpBody = form.finalize()
        return try await send(req)
    }

    func updateMeal(id: String, items: [MealItem]? = nil, mealName: String? = nil, mealNameAr: String? = nil, restaurant: String? = nil, portionFactor: Double? = nil) async throws -> Meal {
        struct Patch: Encodable { var items: [MealItem]?; var meal_name: String?; var meal_name_ar: String?; var restaurant: String?; var portionFactor: Double? }
        var req = request("meals/\(id)", method: "PATCH")
        req.httpBody = try encoder.encode(Patch(items: items, meal_name: mealName, meal_name_ar: mealNameAr, restaurant: restaurant, portionFactor: portionFactor))
        return try await send(req)
    }

    func confirmMeal(id: String) async throws -> Meal { try await send(request("meals/\(id)/confirm", method: "POST")) }

    func deleteMeal(id: String) async throws {
        let _: [String: Bool] = try await send(request("meals/\(id)", method: "DELETE"))
    }

    func meal(id: String) async throws -> Meal { try await send(request("meals/\(id)")) }

    // MARK: Energy / balance

    func balance(date: Date = Date()) async throws -> Balance {
        try await send(request("balance?date=\(DateFormatter.isoDay.string(from: date))"))
    }

    func pushEnergy(_ samples: [EnergySample]) async throws {
        struct Body: Encodable { let samples: [EnergySample] }
        var req = request("energy/samples", method: "POST")
        req.httpBody = try encoder.encode(Body(samples: samples))
        let _: [String: Int] = try await send(req)
    }

    // MARK: Profile

    func profile() async throws -> Profile { try await send(request("profile")) }
    func saveProfile(_ p: Profile) async throws -> Profile {
        var req = request("profile", method: "PUT")
        req.httpBody = try encoder.encode(p)
        return try await send(req)
    }

    // MARK: WHOOP

    func whoopConnectURL() async throws -> URL {
        struct R: Decodable { let url: URL }
        let r: R = try await send(request("integrations/whoop/connect"))
        return r.url
    }
    func whoopStatus() async throws -> Bool {
        struct R: Decodable { let connected: Bool }
        let r: R = try await send(request("integrations/whoop/status"))
        return r.connected
    }
    func whoopSync(from: Date, to: Date) async throws {
        let f = DateFormatter.isoDay
        struct R: Decodable { let cycles: Int }
        let _: R = try await send(request("integrations/whoop/sync?from=\(f.string(from: from))&to=\(f.string(from: to))", method: "POST"))
    }
    func whoopDisconnect() async throws {
        struct R: Decodable { let connected: Bool }
        let _: R = try await send(request("integrations/whoop", method: "DELETE"))
    }

    // MARK: plumbing

    private func request(_ path: String, method: String = "GET") -> URLRequest {
        var req = URLRequest(url: URL(string: path, relativeTo: baseURL.appendingPathComponent("/"))!)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = accessToken { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        else { req.setValue(devUserId, forHTTPHeaderField: "X-User-Id") }
        if let apiKey { req.setValue(apiKey, forHTTPHeaderField: "X-API-Key") } // AUTH_MODE=apikey
        return req
    }

    private func send<T: Decodable>(_ req: URLRequest) async throws -> T {
        let (data, resp) = try await session.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["message"] as? String
            throw APIError.http(code, msg ?? String(data: data, encoding: .utf8) ?? "")
        }
        return try decoder.decode(T.self, from: data)
    }
}

struct MultipartForm {
    private let boundary = "NutriSnap-\(UUID().uuidString)"
    private var body = Data()
    var contentType: String { "multipart/form-data; boundary=\(boundary)" }

    mutating func addField(name: String, value: String) {
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".data(using: .utf8)!)
    }
    mutating func addFile(name: String, filename: String, mime: String, data: Data) {
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\nContent-Type: \(mime)\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n".data(using: .utf8)!)
    }
    func finalize() -> Data { body + "--\(boundary)--\r\n".data(using: .utf8)! }
}

extension UIImage {
    /// Claude vision works best ≤ ~1568 px on the long edge; also keeps uploads small.
    func resizedForUpload(maxSide: CGFloat = 1568) -> UIImage {
        let longest = max(size.width, size.height)
        guard longest > maxSide else { return self }
        let scale = maxSide / longest
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat.default(); format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in draw(in: CGRect(origin: .zero, size: target)) }
    }
}
