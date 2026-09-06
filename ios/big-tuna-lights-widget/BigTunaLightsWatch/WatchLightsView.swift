import SwiftUI
import WatchKit

struct WatchLightsView: View {
    @StateObject private var model = WatchLightsViewModel()
    @State private var selectedPage = 0

    var body: some View {
        TabView(selection: $selectedPage) {
            lightPage.tag(0)
            WatchScoreView().tag(1)
        }
        .tabViewStyle(.verticalPage)
        .onOpenURL { url in
            // Complications cannot legitimately run an App Intent. Their URL
            // therefore opens the relevant native screen as Apple's fallback.
            selectedPage = url.host?.lowercased() == "score" ? 1 : 0
        }
    }

    private var lightPage: some View {
        VStack(spacing: 7) {
            Button {
                Task { await model.toggle() }
            } label: {
                ZStack {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(model.hasKnownState && model.physicalOn ? Color.yellow.opacity(0.58) : Color.gray.opacity(0.34))
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(.thinMaterial)
                        .padding(6)
                    Image(systemName: model.isBusy ? "arrow.triangle.2.circlepath" : model.lightSymbol)
                        .font(.system(size: 40, weight: .semibold))
                        .foregroundStyle(model.hasKnownState && model.physicalOn ? .yellow : .secondary)
                        .symbolEffect(.rotate, options: .repeating, isActive: model.isBusy)
                }
                .frame(height: 96)
            }
            .buttonStyle(.plain)
            .disabled(!model.canControl || model.isBusy)
            .accessibilityLabel("Lights")
            .accessibilityValue(model.hasKnownState ? (model.physicalOn ? "On" : "Off") : "Unknown")
            .accessibilityHint(model.canControl ? "Double tap to turn the lights \(model.physicalOn ? "off" : "on")" : model.statusText)

            Text(model.hasKnownState ? (model.physicalOn ? "Lights On" : "Lights Off") : "State Unknown")
                .font(.headline)
            if model.isBusy {
                ProgressView().controlSize(.small).accessibilityLabel("Updating lights")
            }
            Text(model.statusText)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .lineLimit(2)
        }
        .padding(.horizontal, 4)
        .task { await model.refresh() }
    }
}

@MainActor
final class WatchLightsViewModel: ObservableObject {
    @Published private(set) var physicalOn = WatchLightStore.cachedState?.physicalOn ?? false
    @Published private(set) var hasKnownState = WatchLightStore.cachedState != nil
    @Published private(set) var statusText = "Checking status…"
    @Published private(set) var isBusy = false
    @Published private(set) var canControl = false
    var lightSymbol: String { hasKnownState ? (physicalOn ? "lightbulb.fill" : "lightbulb") : "lightbulb.slash" }

    func refresh() async {
        guard WatchLightStore.canControl, let token = WatchLightStore.token else {
            applyCachedOrSignedOut()
            return
        }
        do {
            let state = try await WatchLightAPI.fetchState(token: token)
            applyConfirmed(state)
        } catch {
            applyOffline(error)
        }
    }

    func toggle() async {
        guard !isBusy else { return }
        guard let token = WatchLightStore.token, WatchLightStore.canControl else {
            statusText = "Refresh a confirmed state before controlling."
            canControl = false
            return
        }
        isBusy = true
        statusText = "Updating lights..."
        defer { isBusy = false }
        do {
            // Keep the Watch honest: the command response is followed by a new
            // server read, which is the state presented to the wearer.
            let result = try await WatchLightCommandCoordinator.shared.toggle(token: token)
            applyConfirmed(result.state, verified: result.didVerify)
            WKInterfaceDevice.current().play(.success)
        } catch {
            applyOffline(error)
            WKInterfaceDevice.current().play(.failure)
        }
    }

    private func applyConfirmed(_ state: WatchLightState, verified: Bool = true) {
        WatchLightStore.save(state)
        physicalOn = state.physicalOn
        hasKnownState = true
        canControl = state.hasConfirmedDesiredState && WatchLightStore.canControl
        statusText = verified
            ? (state.recentlyPolled ? "Relay confirmed" : "Relay status is stale")
            : "Command acknowledged · verification unavailable"
    }

    private func applyCachedOrSignedOut() {
        if let cached = WatchLightStore.cachedState {
            physicalOn = cached.physicalOn
            hasKnownState = true
            statusText = "Sign in on iPhone to control."
        } else {
            hasKnownState = false
            statusText = "Sign in on iPhone."
        }
        canControl = false
    }

    private func applyOffline(_ error: Error) {
        if let cached = WatchLightStore.cachedState {
            physicalOn = cached.physicalOn
            hasKnownState = true
            statusText = "Offline — last confirmed state"
        } else {
            hasKnownState = false
            statusText = error.localizedDescription
        }
        canControl = false
    }
}
