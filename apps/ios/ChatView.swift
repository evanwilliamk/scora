import SwiftUI

struct ChatMessage {
  let id = UUID()
  let text: String
  let isUser: Bool
  let drivers: [Driver] = []
}

struct Driver {
  let metric: String
  let value: String
  let trend: String?
}

struct ChatView: View {
  @ObservedObject var tokenManager: TokenManager
  @State private var messages: [ChatMessage] = []
  @State private var inputText = ""
  @State private var isLoading = false
  
  let apiBaseURL = "https://zonal-prosperity-production-3965.up.railway.app"
  
  var body: some View {
    ZStack {
      Color.black.ignoresSafeArea()
      
      VStack(spacing: 0) {
        // Header
        VStack(spacing: 8) {
          HStack {
            VStack(alignment: .leading, spacing: 4) {
              Text("SCORA")
                .font(.system(size: 18, weight: .bold))
                .foregroundColor(.white)
              Text("Posture reading")
                .font(.system(size: 12))
                .foregroundColor(.gray)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
              Text(tokenManager.athleteName ?? "Athlete")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.white)
              Text("Connected")
                .font(.system(size: 10))
                .foregroundColor(.green)
            }
          }
          .padding(16)
          Divider().background(Color(white: 0.1))
        }
        
        // Messages
        ScrollViewReader { proxy in
          ScrollView {
            VStack(alignment: .leading, spacing: 12) {
              ForEach(messages, id: \.id) { message in
                if message.isUser {
                  // User message
                  HStack {
                    Spacer()
                    Text(message.text)
                      .font(.system(size: 14))
                      .foregroundColor(.white)
                      .padding(12)
                      .background(Color(white: 0.15))
                      .cornerRadius(8)
                  }
                } else {
                  // AI response
                  VStack(alignment: .leading, spacing: 8) {
                    Text(message.text)
                      .font(.system(size: 14))
                      .foregroundColor(.white)
                    
                    // Drivers (metrics)
                    if !message.drivers.isEmpty {
                      VStack(alignment: .leading, spacing: 6) {
                        ForEach(message.drivers, id: \.metric) { driver in
                          HStack(spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                              Text(driver.metric)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundColor(.gray)
                              HStack(spacing: 4) {
                                Text(driver.value)
                                  .font(.system(size: 13, weight: .bold))
                                  .foregroundColor(.white)
                                if let trend = driver.trend {
                                  Text(trend)
                                    .font(.system(size: 11))
                                    .foregroundColor(.green)
                                }
                              }
                            }
                            Spacer()
                          }
                          .padding(8)
                          .background(Color(white: 0.08))
                          .cornerRadius(6)
                        }
                      }
                    }
                  }
                  .padding(12)
                  .background(Color(white: 0.08))
                  .cornerRadius(8)
                }
              }
              
              if isLoading {
                HStack(spacing: 6) {
                  Circle()
                    .fill(Color.gray)
                    .frame(width: 6, height: 6)
                  Circle()
                    .fill(Color.gray)
                    .frame(width: 6, height: 6)
                  Circle()
                    .fill(Color.gray)
                    .frame(width: 6, height: 6)
                }
                .padding(12)
              }
            }
            .padding(12)
            .id("bottom")
            .onChange(of: messages.count) { _ in
              withAnimation {
                proxy.scrollTo("bottom", anchor: .bottom)
              }
            }
          }
        }
        
        Divider().background(Color(white: 0.1))
        
        // Input
        HStack(spacing: 8) {
          TextField("Ask SCORA...", text: $inputText)
            .font(.system(size: 14))
            .foregroundColor(.white)
            .padding(10)
            .background(Color(white: 0.08))
            .cornerRadius(6)
          
          Button(action: sendMessage) {
            Image(systemName: "arrow.up")
              .font(.system(size: 14, weight: .semibold))
              .foregroundColor(.black)
              .frame(width: 36, height: 36)
              .background(Color.white)
              .cornerRadius(6)
          }
          .disabled(inputText.trimmingCharacters(in: .whitespaces).isEmpty || isLoading)
          .opacity(inputText.trimmingCharacters(in: .whitespaces).isEmpty || isLoading ? 0.5 : 1)
        }
        .padding(12)
      }
    }
  }
  
  func sendMessage() {
    let trimmed = inputText.trimmingCharacters(in: .whitespaces)
    guard !trimmed.isEmpty, !isLoading else { return }
    guard let token = tokenManager.stravaToken, let athleteId = tokenManager.athleteId else {
      messages.append(ChatMessage(text: "Not authenticated. Please log in first.", isUser: false))
      return
    }
    
    // Add user message
    messages.append(ChatMessage(text: trimmed, isUser: true))
    inputText = ""
    isLoading = true
    
    // Call CDV endpoint
    let url = URL(string: "\(apiBaseURL)/api/cdv")!
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    
    let payload = [
      "message": trimmed,
      "stravaToken": token,
      "athleteId": athleteId,
    ] as [String: Any]
    
    request.httpBody = try? JSONSerialization.data(withJSONObject: payload)
    
    URLSession.shared.dataTask(with: request) { data, response, error in
      DispatchQueue.main.async {
        isLoading = false
        
        if let error = error {
          messages.append(ChatMessage(text: "Error: \(error.localizedDescription)", isUser: false))
          return
        }
        
        guard let data = data else {
          messages.append(ChatMessage(text: "No response from server.", isUser: false))
          return
        }
        
        do {
          let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
          let voice = json?["voice"] as? String ?? "Unable to generate reading"
          
          // Parse drivers
          var drivers: [Driver] = []
          if let driversArray = json?["drivers"] as? [[String: Any]] {
            for driver in driversArray {
              let metric = driver["metric"] as? String ?? ""
              let value = driver["value"] as? String ?? ""
              let trend = driver["trend"] as? String
              drivers.append(Driver(metric: metric, value: value, trend: trend))
            }
          }
          
          var message = ChatMessage(text: voice, isUser: false)
          message.drivers = drivers
          messages.append(message)
        } catch {
          messages.append(ChatMessage(text: "Failed to parse response.", isUser: false))
        }
      }
    }.resume()
  }
}

#Preview {
  ChatView(tokenManager: TokenManager())
}
