import SwiftUI

struct WatchLightsView: View {
    @StateObject private var model = WatchLightsViewModel()

    var body: some View {
        VStack(spacing: 7) {
            Button {
                Task { await model.toggle() }
            } label: {
                ZStack {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(model.physicalOn ? Color.yellow.opacity(0.58) : Color.gray.opacity(0.34))
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(.thinMaterial)
                        .padding(6)
                    Image(systemName: model.physicalOn ? "lightbulb.fill" : "lightbulb")
                        .font(.system(size: 40, weight: .semibold))
                        .foregroundStyle(model.physicalOn ? .yellow : .secondary)
                }
                .frame(height: 96)
            }
            .buttonStyle(.plain)
            .disabled(!model.canControl || model.isBusy)
            .accessibilityLabel("Lights")
            .accessibilityValue(model.physicalOn ? "On" : "Off")

            Text(model.physicalOn ? "Lights On" : "Lights Off")
                .font(.headline)
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
    @Published private(set) var statusText = "Checking status…"
    @Published private(set) var isBusy = false
    @Published private(set) var canControl = false

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
        guard let token = WatchLightStore.token, WatchLightStore.canControl,
              let knownState = WatchLightStore.cachedState, knownState.hasConfirmedDesiredState else {
            statusText = "Refresh a confirmed state before controlling."
            canControl = false
            return
        }
        isBusy = true
        defer { isBusy = false }
        do {
            // The state is changed only after the server returns its authoritative response.
            let state = try await WatchLightAPI.setPhysicalLight(on: !knownState.physicalOn, token: token)
            applyConfirmed(state)
        } catch {
            applyOffline(error)
        }
    }

    private func applyConfirmed(_ state: WatchLightState) {
        WatchLightStore.save(state)
        physicalOn = state.physicalOn
        canControl = state.hasConfirmedDesiredState && WatchLightStore.canControl
        statusText = state.recentlyPolled ? "Relay confirmed" : "Relay status is stale"
    }

    private func applyCachedOrSignedOut() {
        if let cached = WatchLightStore.cachedState {
            physicalOn = cached.physicalOn
            statusText = "Sign in on iPhone to control."
        } else {
            statusText = "Sign in on iPhone."
        }
        canControl = false
    }

    private func applyOffline(_ error: Error) {
        if let cached = WatchLightStore.cachedState {
            physicalOn = cached.physicalOn
            statusText = "Offline — last confirmed state"
        } else {
            statusText = error.localizedDescription
        }
        canControl = false
    }
}
