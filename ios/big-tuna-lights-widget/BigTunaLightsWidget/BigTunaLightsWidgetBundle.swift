import WidgetKit
import SwiftUI

@main
struct BigTunaLightsWidgetBundle: WidgetBundle {
    var body: some Widget {
        BigTunaLightsWidget()
        WeeklyScoreWidget()
        if #available(iOS 18.0, *) {
            BigTunaLightsControl()
        }
    }
}
