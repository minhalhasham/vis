import CoreMotion
import Foundation

@MainActor
final class MotionController: ObservableObject {
    @Published private(set) var isRunning = false
    @Published private(set) var unavailableReason: String?
    weak var connection: ControllerConnection?

    private let manager = CMMotionManager()
    private var sequence = 0

    func start() {
        guard manager.isDeviceMotionAvailable else {
            unavailableReason = "Device Motion is unavailable on this device. Use a physical iPhone."
            return
        }
        unavailableReason = nil
        sequence = 0
        manager.deviceMotionUpdateInterval = 1.0 / 60.0
        manager.startDeviceMotionUpdates(using: .xArbitraryZVertical, to: .main) { [weak self] sample, error in
            guard let self else { return }
            if let error {
                Task { @MainActor in
                    self.unavailableReason = error.localizedDescription
                    self.stop()
                }
                return
            }
            guard let sample else { return }
            let q = sample.attitude.quaternion
            Task { @MainActor in
                self.sequence += 1
                self.connection?.sendPose(
                    sequence: self.sequence,
                    timestamp: sample.timestamp * 1_000,
                    x: q.x,
                    y: q.y,
                    z: q.z,
                    w: q.w
                )
            }
        }
        isRunning = true
    }

    func stop() {
        manager.stopDeviceMotionUpdates()
        isRunning = false
    }

    func toggle() {
        isRunning ? stop() : start()
    }

    func recenter() {
        connection?.sendRecenter()
    }
}

