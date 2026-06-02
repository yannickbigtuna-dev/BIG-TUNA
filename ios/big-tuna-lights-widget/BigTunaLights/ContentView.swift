import SwiftUI
import WidgetKit

struct ContentView: View {
    @StateObject private var model = LightsViewModel()

    var body: some View {
        ZStack {
            LinearGradient(
                colors: model.physicalOn ? [.yellow.opacity(0.55), .brown.opacity(0.65)] : [.black, .gray.opacity(0.45)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 24) {
                Spacer()

                VStack(spacing: 10) {
                    Image(systemName: model.physicalOn ? "lightbulb.fill" : "lightbulb")
                        .font(.system(size: 74, weight: .semibold))
                        .foregroundStyle(model.physicalOn ? .yellow : .white)
                        .symbolEffect(.pulse, value: model.physicalOn)

                    Text(model.physicalOn ? "Light On" : "Light Off")
                        .font(.largeTitle.weight(.bold))
                        .foregroundStyle(.white)

                    Text(model.statusText)
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.78))
                        .multilineTextAlignment(.center)
                        .frame(minHeight: 40)
                }

                Button {
                    Task { await model.toggleLight() }
                } label: {
                    Label("Flick Light", systemImage: "power")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                }
                .buttonStyle(.borderedProminent)
                .tint(model.physicalOn ? .orange : .blue)
                .disabled(!model.canControl || model.isBusy)

                if model.isSignedIn {
                    Button("Log Out") {
                        Task { await model.logout() }
                    }
                    .buttonStyle(.bordered)
                    .tint(.white)
                } else {
                    loginPanel
                }

                Spacer()
            }
            .padding(24)
        }
        .task {
            await model.refresh()
        }
    }

    private var loginPanel: some View {
        VStack(spacing: 12) {
            TextField("Username", text: $model.username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textContentType(.username)

            SecureField("Password", text: $model.password)
                .textContentType(.password)

            Button {
                Task { await model.login() }
            } label: {
                Label("Sign In", systemImage: "person.badge.key.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(model.username.isEmpty || model.password.isEmpty || model.isBusy)
        }
        .textFieldStyle(.roundedBorder)
        .padding(16)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
    }
}

@MainActor
final class LightsViewModel: ObservableObject {
    @Published var physicalOn = SharedSettings.lastPhysicalOn ?? false
    @Published var username = SharedSettings.username ?? ""
    @Published var password = ""
    @Published var statusText = "Checking light state..."
    @Published var isBusy = false

    var isSignedIn: Bool {
        SharedSettings.sessionToken != nil
    }

    var canControl: Bool {
        SharedSettings.canControlLight
    }

    func refresh() async {
        do {
            let state = try await BigTunaLightsAPI.fetchState()
            apply(state)
            statusText = SharedSettings.canControlLight ? "Ready for the widget." : "Sign in as yannick to control the light."
        } catch {
            statusText = error.localizedDescription
        }
    }

    func login() async {
        guard !username.isEmpty, !password.isEmpty else { return }
        isBusy = true
        statusText = "Signing in..."
        do {
            let session = try await BigTunaLightsAPI.login(username: username, password: password)
            password = ""
            SharedSettings.saveSession(session)
            WidgetCenter.shared.reloadAllTimelines()
            await refresh()
        } catch {
            statusText = error.localizedDescription
        }
        isBusy = false
    }

    func logout() async {
        let token = SharedSettings.sessionToken
        SharedSettings.clearSession()
        username = ""
        password = ""
        statusText = "Signed out."
        WidgetCenter.shared.reloadAllTimelines()
        if let token {
            await BigTunaLightsAPI.logout(token: token)
        }
    }

    func toggleLight() async {
        guard let token = SharedSettings.sessionToken, SharedSettings.canControlLight else {
            statusText = "Sign in as yannick to control the light."
            return
        }

        let optimisticValue = !physicalOn
        isBusy = true
        physicalOn = optimisticValue
        statusText = "Flicking..."

        do {
            let state = try await BigTunaLightsAPI.setPhysicalLight(on: optimisticValue, token: token)
            apply(state)
            statusText = "Ready for the widget."
            WidgetCenter.shared.reloadAllTimelines()
        } catch {
            physicalOn.toggle()
            statusText = error.localizedDescription
        }
        isBusy = false
    }

    private func apply(_ state: LightState) {
        physicalOn = state.physicalOn
        SharedSettings.saveLastState(state)
    }
}
