import SwiftUI
import WidgetKit
#if canImport(UIKit)
import UIKit
#endif

struct ContentView: View {
    @StateObject private var model = LightsViewModel()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            LinearGradient(colors: model.hasConfirmedState && model.physicalOn ? [.orange.opacity(0.26), Color(uiColor: .systemBackground)] : [Color(uiColor: .systemBackground), .black.opacity(0.07)], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
            ScrollView {
                VStack(spacing: 24) {
                    header
                    lightControl
                    statusLine
                    ScoreStrip(score: model.weeklyScore)
                    accountArea
                }.padding(.horizontal, 22).padding(.vertical, 20)
            }
        }
        .animation(reduceMotion ? nil : .snappy(duration: 0.32), value: model.physicalOn)
        .task { await model.start() }
        .refreshable { await model.refresh() }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 3) {
                Text("LIGHTS").font(.caption.weight(.bold)).tracking(1.5).foregroundStyle(.secondary)
                Text(model.lightTitle).font(.system(size: 42, weight: .bold, design: .rounded)).contentTransition(.numericText()).accessibilityLabel(model.hasConfirmedState ? "Lights are \(model.lightTitle.lowercased())" : "Light state unavailable")
            }
            Spacer()
            Image(systemName: model.lightSymbol).font(.system(size: 30, weight: .semibold)).foregroundStyle(model.hasConfirmedState && model.physicalOn ? .orange : .secondary).accessibilityHidden(true)
        }
    }

    private var lightControl: some View {
        Button { Task { await model.toggleLight() } } label: {
            VStack(spacing: 14) {
                Image(systemName: model.lightSymbol).font(.system(size: 72, weight: .medium)).symbolEffect(.bounce, value: model.physicalOn)
                Text(model.isBusy ? "UPDATING" : (model.hasConfirmedState ? (model.physicalOn ? "TURN OFF" : "TURN ON") : "STATE UNKNOWN")).font(.headline.weight(.semibold)).tracking(0.7)
            }
            .foregroundStyle(model.physicalOn ? Color.orange : Color.primary).frame(maxWidth: .infinity, minHeight: 230)
            .background { RoundedRectangle(cornerRadius: 32, style: .continuous).fill(model.physicalOn ? Color.orange.opacity(0.16) : Color.secondary.opacity(0.09)).overlay { RoundedRectangle(cornerRadius: 32, style: .continuous).stroke(model.physicalOn ? Color.orange.opacity(0.36) : Color.primary.opacity(0.08), lineWidth: 1) } }
            .overlay(alignment: .topTrailing) { if model.isBusy { ProgressView().padding(20).tint(.orange) } }
        }
        .buttonStyle(LightButtonStyle()).disabled(!model.canControl || model.isBusy || !model.hasConfirmedState)
        .accessibilityLabel(model.hasConfirmedState ? (model.physicalOn ? "Turn lights off" : "Turn lights on") : "Light state unavailable")
        .accessibilityValue(model.hasConfirmedState ? "\(model.physicalOn ? "On" : "Off"), \(model.relayRecentlyActive ? "relay responding" : "relay status stale")" : "State unavailable")
        .accessibilityHint(model.canControl ? "Double tap to change the physical lights." : "Sign in as Yannick to enable light controls.")
    }

    private var statusLine: some View {
        HStack(spacing: 8) { Image(systemName: model.statusSymbol).foregroundStyle(model.statusTint); Text(model.statusText).font(.subheadline).foregroundStyle(.secondary); Spacer(minLength: 0) }
            .accessibilityElement(children: .combine).accessibilityLabel("Light status: \(model.statusText)")
    }

    @ViewBuilder private var accountArea: some View {
        if model.isSignedIn {
            Button("Log Out") { Task { await model.logout() } }.buttonStyle(.bordered).disabled(model.isBusy).accessibilityLabel("Log out and disable light controls")
        } else {
            VStack(alignment: .leading, spacing: 12) {
                Text("Owner access").font(.headline)
                Text("Sign in as Yannick to enable controls on this iPhone, widgets, and Watch.").font(.footnote).foregroundStyle(.secondary)
                TextField("Username", text: $model.username).textInputAutocapitalization(.never).autocorrectionDisabled().textContentType(.username)
                SecureField("Password", text: $model.password).textContentType(.password)
                Button("Sign In") { Task { await model.login() } }.buttonStyle(.borderedProminent).tint(.orange).disabled(model.username.isEmpty || model.password.isEmpty || model.isBusy)
            }.textFieldStyle(.roundedBorder).padding(18).background(.thinMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
    }
}

private struct ScoreStrip: View {
    let score: WeeklyScore?
    var body: some View {
        HStack(spacing: 14) {
            scoreSide("YANNICK", value: score?.yannickScore, tint: .red, aligned: .leading)
            Text("—").font(.title3.monospacedDigit()).foregroundStyle(.tertiary)
            scoreSide("EMMA", value: score?.emmaScore, tint: .blue, aligned: .trailing)
        }.padding(16).frame(maxWidth: .infinity).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(alignment: .bottomLeading) { Text(score.map { "Current week · \($0.dateLabel)\($0.isCached || $0.isStale ? " · last available" : "")" } ?? "Weekly score unavailable").font(.caption2).foregroundStyle(.secondary).padding(.horizontal, 16).padding(.bottom, 7) }
            .padding(.bottom, 16).accessibilityElement(children: .combine)
            .accessibilityLabel(score.map { "Current weekly score. Yannick \($0.yannickScore), Emma \($0.emmaScore). \($0.leaderDescription)." } ?? "Weekly score unavailable")
    }
    private func scoreSide(_ name: String, value: Int?, tint: Color, aligned: HorizontalAlignment) -> some View {
        VStack(alignment: aligned, spacing: 3) { Text(name).font(.caption2.weight(.bold)).tracking(0.7).foregroundStyle(tint); Text(value.map(String.init) ?? "–").font(.system(size: 30, weight: .bold, design: .rounded).monospacedDigit()) }.frame(maxWidth: .infinity, alignment: aligned == .leading ? .leading : .trailing)
    }
}

private struct LightButtonStyle: ButtonStyle { func makeBody(configuration: Configuration) -> some View { configuration.label.scaleEffect(configuration.isPressed ? 0.975 : 1) } }

@MainActor
final class LightsViewModel: ObservableObject {
    @Published var physicalOn = SharedSettings.lastPhysicalOn ?? false
    @Published var username = SharedSettings.username ?? ""
    @Published var password = ""
    @Published var statusText = "Sign in to check the lights."
    @Published var isBusy = false
    @Published var hasConfirmedState = SharedSettings.lastPhysicalOn != nil
    @Published var relayRecentlyActive = SharedSettings.relayRecentlyActive
    @Published var weeklyScore: WeeklyScore? = SharedSettings.lastWeeklyScore
    var isSignedIn: Bool { SharedSettings.sessionToken != nil }
    var canControl: Bool { SharedSettings.canControlLight }
    var lightTitle: String { hasConfirmedState ? (physicalOn ? "ON" : "OFF") : "UNKNOWN" }
    var lightSymbol: String { hasConfirmedState ? (physicalOn ? "lightbulb.fill" : "lightbulb") : "lightbulb.slash" }
    var statusSymbol: String { isBusy ? "arrow.triangle.2.circlepath" : (relayRecentlyActive ? "checkmark.circle.fill" : "exclamationmark.triangle.fill") }
    var statusTint: Color { isBusy ? .orange : (relayRecentlyActive ? .green : .secondary) }

    func start() async { async let light: Void = refresh(); async let score: Void = refreshScore(); _ = await (light, score); await pollWhileForeground() }
    func refresh(presentBusy: Bool = true) async {
        guard let token = SharedSettings.sessionToken else { return }
        if presentBusy { isBusy = true }; defer { if presentBusy { isBusy = false } }
        do { SharedSettings.setAccessVerified(try await BigTunaLightsAPI.validateOwner(token: token)); let state = try await LightService.shared.getCurrentLightState(token: token); apply(state); statusText = state.recentlyPolled ? "Connected and confirmed." : "Last command confirmed; relay has not checked in recently." } catch { handle(error) }
    }
    func refreshScore() async { weeklyScore = try? await ScoreService.shared.getCurrentWeeklyScore() }
    func login() async {
        guard !username.isEmpty, !password.isEmpty else { return }; isBusy = true; statusText = "Signing in…"; defer { isBusy = false }
        do { let session = try await BigTunaLightsAPI.login(username: username, password: password); password = ""; SharedSettings.saveSession(session); IPhoneWatchConnectivity.shared.publishCurrentContext(); reloadSurfaces(); await refresh(presentBusy: false) } catch { handle(error) }
    }
    func logout() async { let token = SharedSettings.sessionToken; SharedSettings.clearSession(); IPhoneWatchConnectivity.shared.publishCurrentContext(); username = ""; password = ""; statusText = "Signed out. Controls are disabled."; reloadSurfaces(); if let token { await BigTunaLightsAPI.logout(token: token) } }
    func toggleLight() async {
        guard let token = SharedSettings.sessionToken, canControl, hasConfirmedState else { statusText = "Sign in as Yannick and refresh a confirmed state first."; return }
        let previous = physicalOn; let target = !previous; physicalOn = target; isBusy = true; statusText = "Updating light…"; defer { isBusy = false }
        do { let result = try await LightService.shared.setLightState(target, token: token); apply(result.state); statusText = result.verification == .verified ? "Light confirmed." : "Light changed, but verification is unavailable."; haptic(success: true) } catch { physicalOn = previous; handle(error); haptic(success: false) }
    }
    private func apply(_ state: LightState) { physicalOn = state.physicalOn; hasConfirmedState = true; relayRecentlyActive = state.recentlyPolled; SharedSettings.saveLastState(state); IPhoneWatchConnectivity.shared.publishCurrentContext(); reloadSurfaces() }
    private func handle(_ error: Error) {
        if case BigTunaLightsAPIError.notAuthenticated = error {
            SharedSettings.clearSession()
            IPhoneWatchConnectivity.shared.publishCurrentContext()
            reloadSurfaces()
            username = ""
            statusText = "Your session expired. Sign in again."
        } else {
            statusText = hasConfirmedState ? "\(error.localizedDescription) Showing the last confirmed state." : error.localizedDescription
        }
    }
    private func reloadSurfaces() { WidgetCenter.shared.reloadAllTimelines(); if #available(iOS 18.0, *) { ControlCenter.shared.reloadControls(ofKind: "YannickLightsControl") } }
    private func haptic(success: Bool) {
        #if canImport(UIKit)
        if success { UINotificationFeedbackGenerator().notificationOccurred(.success) }
        else { UINotificationFeedbackGenerator().notificationOccurred(.error) }
        #endif
    }
    private func pollWhileForeground() async { while !Task.isCancelled { try? await Task.sleep(for: .seconds(30)); guard !Task.isCancelled, isSignedIn, !isBusy else { continue }; await refresh(presentBusy: false) } }
}
