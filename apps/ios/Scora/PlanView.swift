import SwiftUI

// MARK: - Models

// One scheduled session, from GET /api/plan (stored rows) or
// POST /api/plan/manual (freshly parsed rows). Both shapes decode here.
struct PlanWorkout: Decodable, Identifiable, Equatable {
  let date: String // YYYY-MM-DD
  let type: String
  let intensity: String?
  let durationMin: Int?
  let distanceKm: Double?
  let description: String?

  var id: String { "\(date)|\(type)|\(description ?? "")" }

  enum CodingKeys: String, CodingKey {
    case date, type, intensity, description
    case durationMin = "duration_min", distanceKm = "distance_km"
    case scheduledDate = "scheduled_date", plannedType = "planned_type"
    case plannedIntensity = "planned_intensity", plannedDuration = "planned_duration_min"
    case plannedDistance = "planned_distance_km", plannedDescription = "planned_description"
  }

  init(date: String, type: String, intensity: String?, durationMin: Int?, distanceKm: Double?, description: String?) {
    self.date = date; self.type = type; self.intensity = intensity
    self.durationMin = durationMin; self.distanceKm = distanceKm; self.description = description
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    date = try c.decodeIfPresent(String.self, forKey: .date) ?? c.decode(String.self, forKey: .scheduledDate)
    type = try c.decodeIfPresent(String.self, forKey: .type) ?? c.decode(String.self, forKey: .plannedType)
    intensity = try c.decodeIfPresent(String.self, forKey: .intensity) ?? c.decodeIfPresent(String.self, forKey: .plannedIntensity)
    durationMin = try c.decodeIfPresent(Int.self, forKey: .durationMin) ?? c.decodeIfPresent(Int.self, forKey: .plannedDuration)
    distanceKm = try c.decodeIfPresent(Double.self, forKey: .distanceKm) ?? c.decodeIfPresent(Double.self, forKey: .plannedDistance)
    description = try c.decodeIfPresent(String.self, forKey: .description) ?? c.decodeIfPresent(String.self, forKey: .plannedDescription)
  }

  // "Tue Oct 20", from the plan date as written (no time zone shift).
  var dayLabel: String {
    let parse = DateFormatter()
    parse.locale = Locale(identifier: "en_US_POSIX")
    parse.timeZone = TimeZone(identifier: "UTC")
    parse.dateFormat = "yyyy-MM-dd"
    guard let d = parse.date(from: date) else { return date }
    let out = DateFormatter()
    out.timeZone = TimeZone(identifier: "UTC")
    out.dateFormat = "EEE MMM d"
    return out.string(from: d)
  }

  // "tempo · 45 min · 8 km": the parsed values, nothing added.
  var detail: String {
    var parts: [String] = []
    if let intensity { parts.append(intensity) } else { parts.append(type) }
    if let durationMin { parts.append("\(durationMin) min") }
    if let distanceKm {
      parts.append(distanceKm.rounded() == distanceKm ? "\(Int(distanceKm)) km" : String(format: "%.1f km", distanceKm))
    }
    return parts.joined(separator: " · ")
  }
}

struct PlanListResponse: Decodable {
  let workouts: [PlanWorkout]
}

struct PlanSaveResponse: Decodable {
  let workouts: [PlanWorkout]
  let rejected: [String]
}

struct PlanErrorResponse: Decodable {
  let error: String
}

// Race prediction from GET /api/plan/prediction (PRD §5.B.6). Always a range.
struct RacePrediction: Decodable, Equatable {
  let ok: Bool
  let race: String
  let lowS: Int?
  let highS: Int?
  let efforts: [Effort]?
  let usedRaces: Bool?
  let needed: String?

  struct Effort: Decodable, Equatable {
    let date: String
  }

  enum CodingKeys: String, CodingKey {
    case ok, race, efforts, needed
    case lowS = "low_s", highS = "high_s", usedRaces = "used_races"
  }

  static func duration(_ s: Int) -> String {
    let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
    return h > 0 ? "\(h):\(String(format: "%02d", m))" : "\(m):\(String(format: "%02d", sec))"
  }

  // "1:45 – 1:52" with what it rests on, or what is missing.
  var headline: String? {
    guard ok, let lowS, let highS else { return nil }
    return "\(Self.duration(lowS)) – \(Self.duration(highS))"
  }

  var basis: String {
    if !ok { return needed.map { "No estimate yet: needs \($0)." } ?? "No estimate yet." }
    let n = efforts?.count ?? 0
    let what = usedRaces == true ? (n == 1 ? "your recent race" : "your recent races") : "your \(n) best runs of the last 8 weeks"
    return "Based on \(what)."
  }
}

struct PredictionResponse: Decodable {
  let prediction: RacePrediction
}

enum PlanDay {
  // Today in the athlete's own zone, so "Tue" resolves to their Tuesday.
  static func today(_ now: Date = Date(), zone: TimeZone = .current) -> String {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = zone
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: now)
  }

  // Sessions from today on, first 14, for the list after a save.
  static func upcoming(_ rows: [PlanWorkout], today: String) -> [PlanWorkout] {
    Array(rows.filter { $0.date >= today }.sorted { $0.date < $1.date }.prefix(14))
  }

  static func skippedNote(_ count: Int) -> String? {
    guard count > 0 else { return nil }
    return count == 1
      ? "1 line could not be read and was left out."
      : "\(count) lines could not be read and were left out."
  }
}

// MARK: - View

struct PlanView: View {
  @ObservedObject var tokenManager: TokenManager
  @Environment(\.dismiss) private var dismiss

  @State private var text = ""
  @State private var workouts: [PlanWorkout] = []
  @State private var prediction: RacePrediction?
  @State private var note: String?
  @State private var errorText: String?
  @State private var isSaving = false
  @State private var isEditing = false

  private let apiBase = "https://zonal-prosperity-production-3965.up.railway.app"

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Text("Your Plan").font(.headline.bold()).foregroundColor(.white)
        Spacer()
        Button("Done") { dismiss() }.foregroundColor(.orange)
      }
      .padding()

      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          if workouts.isEmpty || isEditing {
            pasteSection
          } else {
            upcomingSection
          }
          if let errorText {
            Text(errorText).font(.footnote).foregroundColor(.gray)
          }
        }
        .padding()
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.black)
    .preferredColorScheme(.dark)
    .task { await loadPlan() }
  }

  private var pasteSection: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Have a training plan?")
        .font(.system(size: 22, weight: .regular, design: .serif))
        .foregroundColor(.white)
      Text("Paste your plan and SCORA reads it alongside your body. One session per line with a day or date works best.")
        .font(.subheadline)
        .foregroundColor(.gray)
      TextEditor(text: $text)
        .scrollContentBackground(.hidden)
        .frame(minHeight: 180)
        .padding(8)
        .background(Color(white: 0.11))
        .cornerRadius(10)
        .foregroundColor(.white)
        .overlay(alignment: .topLeading) {
          if text.isEmpty {
            Text("Paste plan here...").foregroundColor(Color(white: 0.4)).padding(14).allowsHitTesting(false)
          }
        }
      HStack {
        Button(action: { Task { await savePlan() } }) {
          HStack(spacing: 8) {
            if isSaving { ProgressView().tint(.black) }
            Text("Save plan").bold()
          }
          .padding(.horizontal, 18).padding(.vertical, 10)
          .background(Color.orange).foregroundColor(.black).cornerRadius(8)
        }
        .disabled(isSaving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        if isEditing {
          Button("Cancel") { isEditing = false }.foregroundColor(.gray).padding(.leading, 8)
        }
      }
    }
  }

  private var upcomingSection: some View {
    VStack(alignment: .leading, spacing: 10) {
      if let prediction {
        VStack(alignment: .leading, spacing: 4) {
          Text("Race estimate").font(.caption.bold()).foregroundColor(.gray).textCase(.uppercase)
          if let h = prediction.headline {
            Text(h).font(.system(size: 22, weight: .regular, design: .serif)).foregroundColor(.white)
          }
          Text(prediction.basis).font(.footnote).foregroundColor(.gray)
        }
        .padding(.bottom, 4)
      }
      Text("Coming up").font(.caption.bold()).foregroundColor(.gray).textCase(.uppercase)
      if let note { Text(note).font(.footnote).foregroundColor(.gray) }
      ForEach(workouts) { w in
        VStack(alignment: .leading, spacing: 3) {
          HStack {
            Text(w.dayLabel).font(.subheadline.bold()).foregroundColor(.white)
            Spacer()
            Text(w.detail).font(.caption).foregroundColor(.orange)
          }
          if let d = w.description, !d.isEmpty {
            Text(d).font(.footnote).foregroundColor(Color(white: 0.7))
          }
        }
        .padding(12)
        .background(Color(white: 0.11))
        .cornerRadius(10)
      }
      Button("Paste a new plan") { isEditing = true; text = "" }
        .font(.subheadline).foregroundColor(.orange).padding(.top, 4)
    }
  }

  // MARK: Networking

  private func loadPlan() async {
    let today = PlanDay.today()
    var comps = URLComponents(string: "\(apiBase)/api/plan")
    comps?.queryItems = [URLQueryItem(name: "athleteId", value: tokenManager.athleteId), URLQueryItem(name: "today", value: today)]
    guard let url = comps?.url,
          let (data, resp) = try? await URLSession.shared.data(from: url),
          (resp as? HTTPURLResponse)?.statusCode == 200,
          let decoded = try? JSONDecoder().decode(PlanListResponse.self, from: data)
    else { return }
    await MainActor.run { workouts = decoded.workouts }
    await loadPrediction()
  }

  // Off (404) until predictions are switched on; then shown above the plan.
  private func loadPrediction() async {
    var comps = URLComponents(string: "\(apiBase)/api/plan/prediction")
    comps?.queryItems = [URLQueryItem(name: "athleteId", value: tokenManager.athleteId), URLQueryItem(name: "today", value: PlanDay.today())]
    guard let url = comps?.url,
          let (data, resp) = try? await URLSession.shared.data(from: url),
          (resp as? HTTPURLResponse)?.statusCode == 200,
          let decoded = try? JSONDecoder().decode(PredictionResponse.self, from: data)
    else { return }
    await MainActor.run { prediction = decoded.prediction }
  }

  private func savePlan() async {
    guard let url = URL(string: "\(apiBase)/api/plan/manual") else { return }
    await MainActor.run { isSaving = true; errorText = nil }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: [
      "athleteId": tokenManager.athleteId, "text": text, "today": PlanDay.today(),
    ])
    do {
      let (data, resp) = try await URLSession.shared.data(for: req)
      let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
      if status == 200, let saved = try? JSONDecoder().decode(PlanSaveResponse.self, from: data) {
        // Show what was saved, even when the plan starts weeks from now.
        await MainActor.run {
          workouts = PlanDay.upcoming(saved.workouts, today: PlanDay.today())
          note = PlanDay.skippedNote(saved.rejected.count)
          isEditing = false
          isSaving = false
        }
        NotificationCenter.default.post(name: Notification.Name("planChanged"), object: nil)
      } else {
        let msg = (try? JSONDecoder().decode(PlanErrorResponse.self, from: data))?.error ?? "Saving the plan failed."
        await MainActor.run { errorText = msg; isSaving = false }
      }
    } catch {
      await MainActor.run { errorText = error.localizedDescription; isSaving = false }
    }
  }
}
