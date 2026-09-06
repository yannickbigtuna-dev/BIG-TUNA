import AppIntents

/// Registers the four first-class light actions with Shortcuts and Siri. The
/// actions themselves remain scoped-token operations, so discoverability never
/// grants access to a signed-out device.
struct YannickLightsShortcuts: AppShortcutsProvider {
    static var shortcutTileColor: ShortcutTileColor { .orange }

    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: TurnLightsOnIntent(),
            phrases: ["Turn on lights in \(.applicationName)"],
            shortTitle: "Turn Lights On",
            systemImageName: "lightbulb.fill"
        )
        AppShortcut(
            intent: TurnLightsOffIntent(),
            phrases: ["Turn off lights in \(.applicationName)"],
            shortTitle: "Turn Lights Off",
            systemImageName: "lightbulb"
        )
        AppShortcut(
            intent: ToggleYannickLightsIntent(),
            phrases: ["Toggle lights in \(.applicationName)"],
            shortTitle: "Toggle Lights",
            systemImageName: "power"
        )
        AppShortcut(
            intent: GetLightStatusIntent(),
            phrases: ["Get light status in \(.applicationName)"],
            shortTitle: "Get Light Status",
            systemImageName: "lightbulb"
        )
    }
}
