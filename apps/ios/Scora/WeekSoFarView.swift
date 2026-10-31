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

  private static let fullNames = ["Mon": "Monday", "Tue": "Tuesday", "Wed": "Wednesday", "Thu": "Thursday",
                                  "Fri": "Friday", "Sat": "Saturday", "Sun": "Sunday"]
  private static func minutes(_ n: Int) -> String { n == 1 ? "1 minute" : "\(n) minutes" }

  // What VoiceOver reads for one bar: the full day name, then the run, then the plan.
  var spokenLabel: String {
    var parts = [Self.fullNames[weekday] ?? weekday]
    switch runMin {
    case nil: parts.append("still ahead")
    case 0?: parts.append("no run")
    case let n?: parts.append(Self.minutes(n))
    }
    if let p = plannedMin, p > 0 { parts.append("plan \(Self.minutes(p))") }
    return parts.joined(separator: ", ")
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
              RoundedRectangle(cornerRadius: 2)
                .fill(h == nil ? Color(white: 0.15) : (day.runMin ?? 0) > 0 ? Color.orange : Color(white: 0.3))
                .frame(height: max(3, 44 * (h ?? 0)))
              // The plan's outline sits in front, so it shows even when the run met it.
              if let p, p > 0 {
                RoundedRectangle(cornerRadius: 2)
                  .stroke(Color(white: 0.75), style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
                  .frame(height: max(4, 44 * p))
              }
            }
            .frame(height: 44, alignment: .bottom)
            Text(String(day.weekday.prefix(1))).font(.caption2).foregroundColor(.gray)
          }
          .frame(maxWidth: .infinity)
          .accessibilityElement(children: .ignore)
          .accessibilityLabel(day.spokenLabel)
        }
      }
      .frame(height: 64, alignment: .bottom)
      Text(week.line).font(.footnote).foregroundColor(Color(white: 0.75))
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}
