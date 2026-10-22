import SwiftUI

// Week So Far (PRD §5.A.3): Monday to today in run minutes, with the line
// the server builds from the same numbers.

struct WeekSoFarDay: Decodable, Equatable {
  let date: String
  let weekday: String
  let runMin: Int?
  var plannedMin: Int? = nil // only when the athlete has a plan

  enum CodingKeys: String, CodingKey {
    case date, weekday
    case runMin = "run_min"
    case plannedMin = "planned_min"
  }
}

struct WeekSoFar: Decodable, Equatable {
  let days: [WeekSoFarDay]
  let line: String

  // One scale for run and planned minutes, so the two are comparable.
  private var top: Double { Double((days.compactMap(\.runMin) + days.compactMap(\.plannedMin)).max() ?? 0) }

  // Bar heights as a share of the tallest day; days ahead are nil.
  var heights: [Double?] {
    let top = top
    return days.map { d in d.runMin.map { top > 0 ? Double($0) / top : 0 } }
  }

  // The plan's outline behind each bar, including days ahead; nil without a plan.
  var plannedHeights: [Double?] {
    let top = top
    return days.map { d in d.plannedMin.map { top > 0 ? Double($0) / top : 0 } }
  }
}

struct WeekSoFarView: View {
  let week: WeekSoFar

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Week So Far").font(.caption.bold()).foregroundColor(.gray).textCase(.uppercase)
      HStack(alignment: .bottom, spacing: 6) {
        ForEach(Array(zip(week.days, zip(week.heights, week.plannedHeights))), id: \.0.date) { day, hp in
          let (h, p) = hp
          VStack(spacing: 4) {
            ZStack(alignment: .bottom) {
              if let p, p > 0 {
                RoundedRectangle(cornerRadius: 2)
                  .stroke(Color(white: 0.45), style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
                  .frame(height: 44 * p)
              }
              RoundedRectangle(cornerRadius: 2)
                .fill(h == nil ? Color(white: 0.15) : (day.runMin ?? 0) > 0 ? Color.orange : Color(white: 0.3))
                .frame(height: max(3, 44 * (h ?? 0)))
            }
            .frame(height: 44, alignment: .bottom)
            Text(String(day.weekday.prefix(1))).font(.caption2).foregroundColor(.gray)
          }
          .frame(maxWidth: .infinity)
          .accessibilityElement(children: .ignore)
          .accessibilityLabel("\(day.weekday): \(day.runMin.map { "\($0) minutes" } ?? "ahead")\(day.plannedMin.map { $0 > 0 ? ", plan \($0) minutes" : "" } ?? "")")
        }
      }
      .frame(height: 64, alignment: .bottom)
      Text(week.line).font(.footnote).foregroundColor(Color(white: 0.75))
    }
  }
}
