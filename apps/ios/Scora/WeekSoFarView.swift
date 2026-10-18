import SwiftUI

// Week So Far (PRD §5.A.3): Monday to today in run minutes, with the line
// the server builds from the same numbers.

struct WeekSoFarDay: Decodable, Equatable {
  let date: String
  let weekday: String
  let runMin: Int?

  enum CodingKeys: String, CodingKey {
    case date, weekday
    case runMin = "run_min"
  }
}

struct WeekSoFar: Decodable, Equatable {
  let days: [WeekSoFarDay]
  let line: String

  // Bar heights as a share of the tallest day; days ahead are nil.
  var heights: [Double?] {
    let top = Double(days.compactMap(\.runMin).max() ?? 0)
    return days.map { d in d.runMin.map { top > 0 ? Double($0) / top : 0 } }
  }
}

struct WeekSoFarView: View {
  let week: WeekSoFar

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Week So Far").font(.caption.bold()).foregroundColor(.gray).textCase(.uppercase)
      HStack(alignment: .bottom, spacing: 6) {
        ForEach(Array(zip(week.days, week.heights)), id: \.0.date) { day, h in
          VStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 2)
              .fill(h == nil ? Color(white: 0.15) : (day.runMin ?? 0) > 0 ? Color.orange : Color(white: 0.3))
              .frame(height: max(3, 44 * (h ?? 0)))
            Text(String(day.weekday.prefix(1))).font(.caption2).foregroundColor(.gray)
          }
          .frame(maxWidth: .infinity)
          .accessibilityElement(children: .ignore)
          .accessibilityLabel("\(day.weekday): \(day.runMin.map { "\($0) minutes" } ?? "ahead")")
        }
      }
      .frame(height: 64, alignment: .bottom)
      Text(week.line).font(.footnote).foregroundColor(Color(white: 0.75))
    }
  }
}
