import AppIntents
import SwiftUI
import WidgetKit

// The owning product replaces the placeholder store/action with its versioned,
// authenticated state client. Keeping the control in the existing WidgetKit
// extension avoids creating another Apple bundle identifier.
@available(iOS 18.0, *)
struct FactoryControlValueProvider: ControlValueProvider {
    var previewValue: Bool { false }

    func currentValue() async throws -> Bool {
        FactorySharedStore.defaults.bool(forKey: "factory.controlState")
    }
}

@available(iOS 18.0, *)
struct FactorySetControlIntent: SetValueIntent {
    static var title: LocalizedStringResource = "Set Control"
    @Parameter(title: "On") var value: Bool

    init() {}
    init(value: Bool) { self.value = value }

    func perform() async throws -> some IntentResult {
        FactorySharedStore.defaults.set(value, forKey: "factory.controlState")
        return .result()
    }
}

@available(iOS 18.0, *)
struct FactoryControl: ControlWidget {
    let kind = "FactoryControl"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: kind, provider: FactoryControlValueProvider()) { value in
            ControlWidgetToggle(FactoryAppConfiguration.name, isOn: value, action: FactorySetControlIntent())
        }
        .displayName(FactoryAppConfiguration.name)
        .description("A stateful system control.")
    }
}
