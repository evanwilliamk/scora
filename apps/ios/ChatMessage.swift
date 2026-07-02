import Foundation

/// A single metric ("driver") returned by the CDV endpoint, e.g.
/// `{ metric: "Weekly Volume", value: "45 miles", trend: "+10%" }`.
struct ChatDriver: Identifiable, Decodable {
  var id: String { metric }
  let metric: String
  let value: String
  let trend: String?
}

enum ChatRole {
  case user
  case assistant
  case system // errors / status messages rendered inline
}

struct ChatMessage: Identifiable {
  let id = UUID()
  let role: ChatRole
  let text: String
  var drivers: [ChatDriver] = []
  let timestamp = Date()
}
