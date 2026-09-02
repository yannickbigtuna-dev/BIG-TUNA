import SwiftUI
import WidgetKit

struct ContentView: View {
    @StateObject private var model = LightsViewModel()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            ambientBackground

            VStack(spacing: 22) {
                Spacer(minLength: 24)
                switchPlate
                Text(model.statusText)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(model.physicalOn ? Color.brown.opacity(0.8) : .secondary)
                    .multilineTextAlignment(.center)
                    .frame(minHeight: 20)
                    .padding(.horizontal, 24)
                accountArea
                Spacer(minLength: 18)
            }
            .padding(.horizontal, 24)
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.32), value: model.physicalOn)
        .task {
            await model.refresh()
            await model.pollWhileForeground()
        }
        .refreshable { await model.refresh() }
    }

    private var ambientBackground: some View {
        ZStack {
            LinearGradient(
                colors: model.physicalOn ? [Color(red: 0.72, green: 0.57, blue: 0.28), Color(red: 0.35, green: 0.25, blue: 0.12)] : [Color.black, Color(white: 0.12)],
                startPoint: .top,
                endPoint: .bottom
            )
            RadialGradient(
                colors: model.physicalOn ? [.yellow.opacity(0.52), .clear] : [.yellow.opacity(0.08), .clear],
                center: .center,
                startRadius: 4,
                endRadius: 330
            )
        }
        .ignoresSafeArea()
    }

    private var switchPlate: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(model.physicalOn ? Color(red: 0.82, green: 0.77, blue: 0.65) : Color(white: 0.23))
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(model.physicalOn ? Color(red: 0.63, green: 0.56, blue: 0.43) : Color.white.opacity(0.15), lineWidth: 1)
                }
                .shadow(color: .black.opacity(0.44), radius: 22, y: 17)

            VStack {
                StatusScrew(isActive: model.canControl, label: "Owner access \(model.canControl ? "verified" : "not verified")")
                Spacer()
                StatusScrew(isActive: model.relayRecentlyActive, label: "Relay \(model.relayRecentlyActive ? "recently active" : "not recently active")")
            }
            .padding(.vertical, 21)

            Button {
                Task { await model.toggleLight() }
            } label: {
                SwitchPaddle(isOn: model.physicalOn, isBusy: model.isBusy)
            }
            .buttonStyle(.plain)
            .disabled(!model.canControl || model.isBusy || !model.hasConfirmedState)
            .accessibilityLabel("Lights")
            .accessibilityValue(model.physicalOn ? "On" : "Off")
            .accessibilityHint(model.canControl ? "Double tap to toggle the lights." : "Sign in as yannick to control the lights.")
        }
        .frame(width: min(UIScreen.main.bounds.width * 0.62, 210), height: min(UIScreen.main.bounds.width * 0.97, 328))
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var accountArea: some View {
        if model.isSignedIn {
            Button("Log Out") { Task { await model.logout() } }
                .buttonStyle(.bordered)
                .tint(model.physicalOn ? .brown : .white)
                .disabled(model.isBusy)
                .accessibilityLabel("Log out and disable light controls")
        } else {
            VStack(spacing: 10) {
                TextField("Username", text: $model.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textContentType(.username)
                SecureField("Password", text: $model.password)
                    .textContentType(.password)
                Button("Sign In") { Task { await model.login() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.username.isEmpty || model.password.isEmpty || model.isBusy)
            }
            .textFieldStyle(.roundedBorder)
            .padding(14)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .accessibilityElement(children: .contain)
        }
    }
}

private struct StatusScrew: View {
    let isActive: Bool
    let label: String

    var body: some View {
        Circle()
            .fill(RadialGradient(
                colors: isActive ? [.white, .green, Color(red: 0.1, green: 0.35, blue: 0.15)] : [.white.opacity(0.75), .gray, Color(white: 0.25)],
                center: .topLeading,
                startRadius: 1,
                endRadius: 8
            ))
            .frame(width: 11, height: 11)
            .shadow(color: isActive ? .green.opacity(0.75) : .clear, radius: 5)
            .accessibilityLabel(label)
    }
}

private struct SwitchPaddle: View {
    let isOn: Bool
    let isBusy: Bool

    var body: some View {
        RoundedRectangle(cornerRadius: 9, style: .continuous)
            .fill(LinearGradient(
                colors: isOn ? [Color(red: 0.93, green: 0.87, blue: 0.72), Color(red: 0.74, green: 0.68, blue: 0.56)] : [Color(white: 0.3), Color(white: 0.16)],
                startPoint: .top,
                endPoint: .bottom
            ))
            .overlay(alignment: .center) { Rectangle().fill(.black.opacity(0.18)).frame(height: 1).padding(.horizontal, 8) }
            .overlay { RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(.white.opacity(isOn ? 0.4 : 0.12), lineWidth: 1) }
            .shadow(color: .black.opacity(0.42), radius: 6, y: 5)
            .rotation3DEffect(.degrees(isOn ? 13 : -13), axis: (x: 1, y: 0, z: 0), anchor: isOn ? .top : .bottom, perspective: 0.55)
            .opacity(isBusy ? 0.72 : 1)
            .frame(width: 94, height: 150)
    }
}

@MainActor
final class LightsViewModel: ObservableObject {
    @Published var physicalOn = SharedSettings.lastPhysicalOn ?? false
    @Published var username = SharedSettings.username ?? ""
    @Published var password = ""
    @Published var statusText = "Sign in to check the lights."
    @Published var isBusy = false
    @Published var hasConfirmedState = SharedSettings.lastPhysicalOn != nil
    @Published var relayRecentlyActive = SharedSettings.relayRecentlyActive

    var isSignedIn: Bool { SharedSettings.sessionToken != nil }
    var canControl: Bool { SharedSettings.canControlLight }

    func refresh(presentBusy: Bool = true) async {
        guard let token = SharedSettings.sessionToken else { return }
        if presentBusy { isBusy = true }
        defer { if presentBusy { isBusy = false } }
        do {
            let owner = try await BigTunaLightsAPI.validateOwner(token: token)
            SharedSettings.setAccessVerified(owner)
            guard owner else { statusText = "This account cannot control the lights."; return }
            let state = try await BigTunaLightsAPI.fetchState(token: token)
            apply(state)
            statusText = state.recentlyPolled ? "Ready." : "Relay has not checked in recently."
        } catch BigTunaLightsAPIError.notAuthenticated {
            SharedSettings.clearSession()
            IPhoneWatchConnectivity.shared.publishCurrentContext()
            username = ""
            statusText = "Your session expired. Sign in again."
        } catch {
            statusText = hasConfirmedState ? "Showing the last confirmed state. Pull to retry." : error.localizedDescription
        }
    }

    func login() async {
        guard !username.isEmpty, !password.isEmpty else { return }
        isBusy = true
        statusText = "Signing in…"
        defer { isBusy = false }
        do {
            let session = try await BigTunaLightsAPI.login(username: username, password: password)
            password = ""
            SharedSettings.saveSession(session)
            IPhoneWatchConnectivity.shared.publishCurrentContext()
            WidgetCenter.shared.reloadAllTimelines()
            await refresh()
        } catch { statusText = error.localizedDescription }
    }

    func logout() async {
        let token = SharedSettings.sessionToken
        SharedSettings.clearSession()
        IPhoneWatchConnectivity.shared.publishCurrentContext()
        username = ""
        password = ""
        statusText = "Signed out."
        WidgetCenter.shared.reloadAllTimelines()
        if #available(iOS 18.0, *) {
            ControlCenter.shared.reloadControls(ofKind: "BigTunaLightsControl")
        }
        if let token { await BigTunaLightsAPI.logout(token: token) }
    }

    func toggleLight() async {
        guard let token = SharedSettings.sessionToken, canControl, hasConfirmedState else {
            statusText = "Sign in as yannick to control the light."
            return
        }
        isBusy = true
        statusText = "Setting light…"
        defer { isBusy = false }
        do {
            let state = try await BigTunaLightsAPI.setPhysicalLight(on: !physicalOn, token: token)
            apply(state)
            statusText = state.recentlyPolled ? "Ready." : "Light changed; relay has not checked in recently."
            WidgetCenter.shared.reloadAllTimelines()
        } catch BigTunaLightsAPIError.notAuthenticated {
            SharedSettings.clearSession()
            IPhoneWatchConnectivity.shared.publishCurrentContext()
            username = ""
            statusText = "Your session expired. Sign in again."
        } catch { statusText = error.localizedDescription }
    }

    private func apply(_ state: LightState) {
        physicalOn = state.physicalOn
        hasConfirmedState = true
        relayRecentlyActive = state.recentlyPolled
        SharedSettings.saveLastState(state)
        IPhoneWatchConnectivity.shared.publishCurrentContext()
        if #available(iOS 18.0, *) {
            ControlCenter.shared.reloadControls(ofKind: "BigTunaLightsControl")
        }
    }

    /// While this screen is visible, reflect website/HomeKit/external changes
    /// without putting the switch into a busy state or re-showing loading UI.
    func pollWhileForeground() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(8))
            guard !Task.isCancelled, isSignedIn, !isBusy else { continue }
            await refresh(presentBusy: false)
        }
    }
}
