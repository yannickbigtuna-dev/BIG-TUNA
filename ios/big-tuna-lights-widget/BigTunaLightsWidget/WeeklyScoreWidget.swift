import SwiftUI
import WidgetKit

struct WeeklyScoreEntry: TimelineEntry {
    let date: Date
    let score: WeeklyScore?
    let failureMessage: String?
}

struct WeeklyScoreTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> WeeklyScoreEntry {
        WeeklyScoreEntry(date: .now, score: SharedSettings.lastWeeklyScore?.markedCached(), failureMessage: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (WeeklyScoreEntry) -> Void) {
        completion(WeeklyScoreEntry(date: .now, score: SharedSettings.lastWeeklyScore?.markedCached(), failureMessage: nil))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WeeklyScoreEntry>) -> Void) {
        Task {
            do {
                let score = try await ScoreService.shared.getCurrentWeeklyScore()
                completion(Timeline(entries: [WeeklyScoreEntry(date: .now, score: score, failureMessage: nil)], policy: .after(.now.addingTimeInterval(60 * 60))))
            } catch {
                let cached = SharedSettings.lastWeeklyScore?.markedCached()
                completion(Timeline(entries: [WeeklyScoreEntry(date: .now, score: cached, failureMessage: cached == nil ? "Score unavailable" : nil)], policy: .after(.now.addingTimeInterval(30 * 60))))
            }
        }
    }
}

struct WeeklyScoreWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "YannickLights.WeeklyScore", provider: WeeklyScoreTimelineProvider()) { entry in
            WeeklyScoreWidgetView(entry: entry)
        }
        .configurationDisplayName("Yannick vs Emma")
        .description("This week's Yannick versus Emma score.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

private struct WeeklyScoreWidgetView: View {
    let entry: WeeklyScoreEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        Group {
            if let score = entry.score {
                switch family {
                case .systemSmall: smallScorecard(score)
                case .systemLarge: largeScorecard(score)
                default: mediumScorecard(score)
                }
            } else {
                unavailableCard
            }
        }
        .containerBackground(for: .widget) { Color(uiColor: .secondarySystemBackground) }
    }

    private func mediumScorecard(_ score: WeeklyScore) -> some View {
        VStack(spacing: 0) {
            header(score, icon: "figure.run")
            Spacer(minLength: 10)
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                competitor(name: "YANNICK", score: score.yannickScore, tint: .red, isLeading: leads(score, yannick: true))
                Text("—")
                    .font(.title2.weight(.light))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
                competitor(name: "EMMA", score: score.emmaScore, tint: .blue, isLeading: leads(score, yannick: false))
            }
            Spacer(minLength: 9)
            footer(score)
        }
        .padding()
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilitySummary(score))
    }

    private func largeScorecard(_ score: WeeklyScore) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            header(score, icon: "trophy")
            Spacer(minLength: 16)
            HStack(alignment: .center, spacing: 18) {
                largeCompetitor(name: "YANNICK", score: score.yannickScore, tint: .red, isLeading: leads(score, yannick: true))
                VStack(spacing: 5) {
                    Text("VS")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.secondary)
                    Rectangle().fill(Color.secondary.opacity(0.22)).frame(width: 1, height: 54)
                }
                largeCompetitor(name: "EMMA", score: score.emmaScore, tint: .blue, isLeading: leads(score, yannick: false))
            }
            Spacer(minLength: 16)
            footer(score)
        }
        .padding(20)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilitySummary(score))
    }

    private func smallScorecard(_ score: WeeklyScore) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Image(systemName: "figure.run")
                    .foregroundStyle(.secondary)
                Spacer()
                staleBadge(score)
            }
            Spacer(minLength: 7)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(score.yannickScore)")
                    .foregroundStyle(.red)
                Text("—").foregroundStyle(.tertiary)
                Text("\(score.emmaScore)")
                    .foregroundStyle(.blue)
            }
            .font(.system(size: 30, weight: .bold, design: .rounded))
            .monospacedDigit()
            Spacer(minLength: 5)
            Text("YANNICK  •  EMMA")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Text(score.dateLabel)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding()
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilitySummary(score))
    }

    private var unavailableCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: "figure.run.circle")
                .font(.title2)
                .foregroundStyle(.secondary)
            Spacer()
            Text("Weekly Score")
                .font(.headline)
            Text(entry.failureMessage ?? "Updates when the challenge is available.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Yannick versus Emma weekly score unavailable")
    }

    private func header(_ score: WeeklyScore, icon: String) -> some View {
        HStack {
            Label("WEEKLY SCORE", systemImage: icon)
                .font(.caption.weight(.bold))
                .foregroundStyle(.secondary)
            Spacer()
            staleBadge(score)
        }
    }

    private func competitor(name: String, score: Int, tint: Color, isLeading: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(name)
                .font(.caption2.weight(.bold))
                .foregroundStyle(tint)
            Text("\(score)")
                .font(.system(size: 44, weight: .bold, design: .rounded))
                .monospacedDigit()
            if isLeading {
                Text("LEADING")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(name), \(score)\(isLeading ? ", leading" : "")")
    }

    private func largeCompetitor(name: String, score: Int, tint: Color, isLeading: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(name).font(.caption.weight(.bold)).foregroundStyle(tint)
            Text("\(score)")
                .font(.system(size: 58, weight: .bold, design: .rounded))
                .monospacedDigit()
            Text(isLeading ? "LEADING" : "CURRENT WEEK")
                .font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func footer(_ score: WeeklyScore) -> some View {
        HStack {
            Text(score.dateLabel).font(.caption2).foregroundStyle(.secondary)
            Spacer()
            Text(score.leaderDescription).font(.caption2.weight(.medium)).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private func staleBadge(_ score: WeeklyScore) -> some View {
        if score.isStale || score.isCached {
            Label("Last update pending", systemImage: "clock")
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(.secondary)
                .labelStyle(.iconOnly)
                .accessibilityLabel("Showing cached score")
        }
    }

    private func leads(_ score: WeeklyScore, yannick: Bool) -> Bool {
        yannick ? score.yannickScore > score.emmaScore : score.emmaScore > score.yannickScore
    }

    private func accessibilitySummary(_ score: WeeklyScore) -> String {
        "Yannick versus Emma, current week. Yannick \(score.yannickScore), Emma \(score.emmaScore). \(score.leaderDescription).\(score.isStale || score.isCached ? " Showing cached data." : "")"
    }
}
