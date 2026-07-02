import Foundation
import Combine

@MainActor
final class ChatViewModel: ObservableObject {
  @Published var messages: [ChatMessage] = []
  @Published var draft: String = ""
  @Published var isSending: Bool = false

  init() {
    if TokenStore.isLinked {
      messages.append(ChatMessage(role: .system, text: "Connected to Strava. Ask SCORA how you're doing."))
    } else {
      messages.append(ChatMessage(role: .system, text: "Connect Strava first, then ask SCORA how you're doing."))
    }
  }

  func send() {
    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, !isSending else { return }

    messages.append(ChatMessage(role: .user, text: text))
    draft = ""
    isSending = true

    Task {
      do {
        let response = try await CDVService.send(message: text)
        messages.append(ChatMessage(role: .assistant, text: response.voice, drivers: response.drivers))
      } catch {
        let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        messages.append(ChatMessage(role: .system, text: message))
      }
      isSending = false
    }
  }
}
