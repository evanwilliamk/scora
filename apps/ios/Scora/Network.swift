import Foundation
import Network

// The sessions every API call goes through. URLSession.shared waits 60 s
// before giving up, which on a weak signal looks like a hung screen.
// Calls that make the server write with OpenAI (the read, the weekly review,
// chat) get longer: the server caps OpenAI at 20 s and then sends its
// validated fallback, so a healthy reply lands well inside 30 s.
enum API {
  static let quickTimeout: TimeInterval = 15
  static let slowTimeout: TimeInterval = 30

  static let session = make(timeout: quickTimeout)
  static let slowSession = make(timeout: slowTimeout)

  static func make(timeout: TimeInterval, protocolClasses: [AnyClass]? = nil) -> URLSession {
    let config = URLSessionConfiguration.default
    config.timeoutIntervalForRequest = timeout
    config.timeoutIntervalForResource = timeout * 2
    // Offline fails at once, so the screen can say so instead of waiting.
    config.waitsForConnectivity = false
    if let protocolClasses { config.protocolClasses = protocolClasses }
    return URLSession(configuration: config)
  }
}

// Why a request never got an answer, in the three ways the athlete can act on.
enum NetworkFailure: Equatable {
  case offline
  case timedOut
  case other

  static func of(_ error: Error) -> NetworkFailure {
    guard let urlError = error as? URLError else { return .other }
    switch urlError.code {
    case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff:
      return .offline
    case .timedOut:
      return .timedOut
    default:
      return .other
    }
  }
}

// What each screen says when a request fails before the server answers.
// Plain sentences, never the system's error text.
enum NetworkText {
  struct Lines: Equatable {
    let offline: String
    let timedOut: String
    let other: String

    func line(for error: Error) -> String {
      switch NetworkFailure.of(error) {
      case .offline: return offline
      case .timedOut: return timedOut
      case .other: return other
      }
    }

    var all: [String] { [offline, timedOut, other] }
  }

  static let read = Lines(
    offline: "You're offline. The read will refresh when the connection is back.",
    timedOut: "The read is taking longer than usual. Pull to try again.",
    other: "The read could not load. Pull to try again.")

  static let weekly = Lines(
    offline: "You're offline. This week's review will load when the connection is back.",
    timedOut: "This week's review is taking longer than usual. Pull to try again.",
    other: "This week's review could not load. Pull to try again.")

  static let chat = Lines(
    offline: "You're offline. Your question is back in the box to send when the connection returns.",
    timedOut: "That answer took too long. Your question is back in the box to send again.",
    other: "That question could not be answered just now. Your question is back in the box to send again.")

  static let planSave = Lines(
    offline: "You're offline. Nothing was saved. Try again when the connection is back.",
    timedOut: "Saving took too long and may not have gone through. Try again in a moment.",
    other: "Saving the plan failed. Try again in a moment.")

  static let planImport = Lines(
    offline: "You're offline. Nothing was imported. Try again when the connection is back.",
    timedOut: "Importing took too long. Try again in a moment.",
    other: "Importing the calendar failed. Try again in a moment.")

  static let planBuild = Lines(
    offline: "You're offline. No plan was built. Try again when the connection is back.",
    timedOut: "Building took too long. Try again in a moment.",
    other: "Building the plan failed. Try again in a moment.")

  static var every: [Lines] { [read, weekly, chat, planSave, planImport, planBuild] }
}

// Whether the phone has a route to the internet, and a notice when it comes
// back, so screens that failed offline load again without a pull.
final class NetworkStatus: ObservableObject {
  static let shared = NetworkStatus()
  static let cameBack = Notification.Name("scora.networkCameBack")

  @Published private(set) var isOnline = true
  private let monitor = NWPathMonitor()

  private init() {
    monitor.pathUpdateHandler = { [weak self] path in
      let online = path.status == .satisfied
      DispatchQueue.main.async { self?.update(online: online) }
    }
    monitor.start(queue: DispatchQueue(label: "scora.network-status"))
  }

  // Starts the monitor; call once early (the dashboard does).
  static func start() { _ = shared }

  private func update(online: Bool) {
    let back = Self.didComeBack(wasOnline: isOnline, isOnline: online)
    isOnline = online
    if back { NotificationCenter.default.post(name: Self.cameBack, object: nil) }
  }

  static func didComeBack(wasOnline: Bool, isOnline: Bool) -> Bool { !wasOnline && isOnline }
}
