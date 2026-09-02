import AppIntents
import SwiftUI
import WidgetKit

// watchOS controls live in the existing Watch WidgetKit extension. The product
// supplies the actual network command and must only persist confirmed state.
@available(watchOS 26.0, *)
struct FactoryWatchControlValueProvider: ControlValueProvider {
    var previewValue: Bool { false }

    func currentValue() async throws -> Bool {
        FactorySharedStore.defaults.bool(forKey: "factory.watchControlState")
    }
}

@available(watchOS 26.0, *)
struct FactorySetWatchControlIntent: SetValueIntent {
    static var title: LocalizedStringResource = "Set Control"
    @Parameter(title: "On") var value: Bool

    init() {}
    init(value: Bool) { self.value = value }

    func perform() async throws -> some IntentResult {
        FactorySharedStore.defaults.set(value, forKey: "factory.watchControlState")
        return .result()
    }
}

@available(watchOS 26.0, *)
struct FactoryWatchControl: ControlWidget {
    let kind = "FactoryWatchControl"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: kind, provider: FactoryWatchControlValueProvider()) { value in
            ControlWidgetToggle(FactoryAppConfiguration.name, isOn: value, action: FactorySetWatchControlIntent())
        }
        .displayName(FactoryAppConfiguration.name)
        .description("A stateful Apple Watch system control.")
    }
}
