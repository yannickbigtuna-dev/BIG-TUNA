import SwiftUI

/// The second vertically-paged screen keeps the weekly result a crown swipe
/// away without competing with the one-tap light control on launch.
struct WatchScoreView: View {
    @StateObject private var model = WatchScoreViewModel()

    var body: some View {
        VStack(spacing: 7) {
            Text("THIS WEEK")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)

            HStack(alignment: .firstTextBaseline, spacing: 9) {
                competitor("YANNICK", score: model.score.yannickScore, tint: .red, alignment: .leading)
                Text("–")
                    .font(.title3.weight(.medium))
                    .foregroundStyle(.secondary)
                competitor("EMMA", score: model.score.emmaScore, tint: .blue, alignment: .trailing)
            }

            Text(model.score.dateLabel)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Text(model.statusText)
                .font(.caption2)
                .foregroundStyle(model.score.isStale ? .orange : .secondary)
                .multilineTextAlignment(.center)
                .lineLimit(2)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Yannick versus Emma weekly score")
        .accessibilityValue(model.score.isAvailable
            ? "Yannick \(model.score.yannickScore!), Emma \(model.score.emmaScore!). \(model.score.leaderDescription). \(model.statusText)"
            : "Score unavailable. \(model.statusText)")
        .task { await model.refresh() }
    }

    private func competitor(_ name: String, score: Int?, tint: Color, alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 1) {
            Text(name).font(.caption2.weight(.bold)).foregroundStyle(tint)
            Text(score.map { String($0) } ?? "—")
                .font(.system(size: 39, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.primary)
        }
        .frame(maxWidth: .infinity, alignment: alignment == .leading ? .leading : .trailing)
    }
}

@MainActor
final class WatchScoreViewModel: ObservableObject {
    @Published private(set) var score = WatchWeeklyScore.cached ?? .unavailable
    @Published private(set) var statusText = "Updating score…"

    func refresh() async {
        do {
            let fresh = try await WatchScoreAPI.fetchCurrentWeeklyScore()
            WatchWeeklyScore.save(fresh)
            score = fresh
            statusText = fresh.leaderDescription
        } catch {
            if let cached = WatchWeeklyScore.cached {
                score = cached.withStale(true)
                statusText = "Cached score · unavailable"
            } else {
                score = .unavailable
                statusText = "Score unavailable"
            }
        }
    }
}
