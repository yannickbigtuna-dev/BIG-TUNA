import SwiftUI
import WidgetKit

@main
struct BigTunaLightsWatchWidgetBundle: WidgetBundle {
    var body: some Widget {
        BigTunaLightsWatchStatusWidget()
        if #available(watchOS 26.0, *) {
            BigTunaLightsWatchControl()
        }
    }
}
