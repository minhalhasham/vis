import SwiftUI

@main
struct MolecVisControllerApp: App {
    @StateObject private var connection = ControllerConnection()
    @StateObject private var motion = MotionController()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(connection)
                .environmentObject(motion)
                .onAppear { motion.connection = connection }
        }
    }
}

