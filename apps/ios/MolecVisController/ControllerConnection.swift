import Foundation

struct PairingPayload: Equatable {
    let host: String
    let port: Int
    let token: String
    let protocolVersion: Int

    init?(uri: String) {
        guard let components = URLComponents(string: uri),
              components.scheme == "molecvis",
              components.host == "pair",
              let host = components.queryItems?.first(where: { $0.name == "host" })?.value,
              let portString = components.queryItems?.first(where: { $0.name == "port" })?.value,
              let port = Int(portString),
              let token = components.queryItems?.first(where: { $0.name == "token" })?.value,
              let versionString = components.queryItems?.first(where: { $0.name == "v" })?.value,
              let version = Int(versionString),
              !host.isEmpty,
              !token.isEmpty else { return nil }
        self.host = host
        self.port = port
        self.token = token
        self.protocolVersion = version
    }
}

@MainActor
final class ControllerConnection: ObservableObject {
    enum State: Equatable {
        case disconnected
        case connecting
        case connected
        case failed(String)
    }

    @Published private(set) var state: State = .disconnected
    private var session: URLSession?
    private var socket: URLSessionWebSocketTask?
    private var outboundQueue: [OutboundMessage] = []
    private var sendInFlight = false
    private var connectionGeneration = 0

    func connect(pairingURI: String) {
        guard let payload = PairingPayload(uri: pairingURI) else {
            state = .failed("That is not a valid MolecVis pairing code.")
            return
        }
        disconnect()
        state = .connecting

        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = true
        let session = URLSession(configuration: configuration)
        guard let url = URL(string: "ws://\(payload.host):\(payload.port)") else {
            state = .failed("The pairing address is invalid.")
            return
        }
        let socket = session.webSocketTask(with: url)
        self.session = session
        self.socket = socket
        let generation = connectionGeneration
        socket.resume()
        enqueue(.hello(protocolVersion: payload.protocolVersion, token: payload.token))
        receiveNext(socket: socket, generation: generation)
    }

    func disconnect() {
        connectionGeneration += 1
        socket?.cancel(with: .goingAway, reason: nil)
        session?.invalidateAndCancel()
        socket = nil
        session = nil
        outboundQueue.removeAll()
        sendInFlight = false
        state = .disconnected
    }

    func sendPose(sequence: Int, timestamp: Double, x: Double, y: Double, z: Double, w: Double) {
        guard state == .connected else { return }
        enqueue(.pose(
            sequence: sequence,
            timestamp: timestamp,
            quaternion: [x, y, z, w]
        ))
    }

    func sendPan(dx: Double, dy: Double) {
        guard state == .connected else { return }
        enqueue(.pan(dx: dx, dy: dy))
    }

    func sendZoom(scale: Double) {
        guard state == .connected else { return }
        enqueue(.zoom(scale: min(max(scale, 0.1), 9.9)))
    }

    func sendRecenter() {
        guard state == .connected else { return }
        enqueue(.recenter)
    }

    private func enqueue(_ message: OutboundMessage) {
        if case .recenter = message {
            // A pose sampled before recenter must never become the new baseline.
            outboundQueue.removeAll { $0.isPose }
        }

        if let last = outboundQueue.indices.last {
            switch (outboundQueue[last], message) {
            case (.pose, .pose):
                outboundQueue[last] = message
                drainOutboundQueue()
                return
            case let (.pan(existingX, existingY), .pan(dx, dy)):
                outboundQueue[last] = .pan(dx: existingX + dx, dy: existingY + dy)
                drainOutboundQueue()
                return
            case let (.zoom(existingScale), .zoom(scale)):
                outboundQueue[last] = .zoom(scale: min(max(existingScale * scale, 0.1), 9.9))
                drainOutboundQueue()
                return
            default:
                break
            }
        }

        outboundQueue.append(message)
        drainOutboundQueue()
    }

    private func drainOutboundQueue() {
        guard !sendInFlight,
              !outboundQueue.isEmpty,
              let socket else { return }

        let message = outboundQueue.removeFirst()
        let object = message.jsonObject
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else {
            drainOutboundQueue()
            return
        }

        sendInFlight = true
        let generation = connectionGeneration
        socket.send(.string(text)) { [weak self] error in
            Task { @MainActor in
                guard let self,
                      self.connectionGeneration == generation,
                      self.socket === socket else { return }
                self.sendInFlight = false
                if let error {
                    self.failConnection(error.localizedDescription)
                    return
                }
                self.drainOutboundQueue()
            }
        }
    }

    private func receiveNext(socket: URLSessionWebSocketTask, generation: Int) {
        socket.receive { [weak self] result in
            Task { @MainActor in
                guard let self,
                      self.connectionGeneration == generation,
                      self.socket === socket else { return }
                switch result {
                case .failure(let error):
                    self.failConnection(error.localizedDescription)
                case .success(let message):
                    self.handle(message)
                    if self.socket != nil {
                        self.receiveNext(socket: socket, generation: generation)
                    }
                }
            }
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        let data: Data
        switch message {
        case .string(let text): data = Data(text.utf8)
        case .data(let value): data = value
        @unknown default: return
        }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String else { return }
        if type == "accepted" {
            state = .connected
        } else if type == "rejected" {
            let reason = object["reason"] as? String ?? "unknown reason"
            state = .failed("Pairing was rejected: \(reason). Scan a new code.")
        }
    }

    private func failConnection(_ message: String) {
        connectionGeneration += 1
        socket?.cancel(with: .goingAway, reason: nil)
        session?.invalidateAndCancel()
        socket = nil
        session = nil
        outboundQueue.removeAll()
        sendInFlight = false
        state = .failed(message)
    }
}

private enum OutboundMessage {
    case hello(protocolVersion: Int, token: String)
    case pose(sequence: Int, timestamp: Double, quaternion: [Double])
    case pan(dx: Double, dy: Double)
    case zoom(scale: Double)
    case recenter

    var isPose: Bool {
        if case .pose = self { return true }
        return false
    }

    var jsonObject: [String: Any] {
        switch self {
        case let .hello(protocolVersion, token):
            return [
                "type": "hello",
                "protocolVersion": protocolVersion,
                "token": token,
                "client": "ios"
            ]
        case let .pose(sequence, timestamp, quaternion):
            return [
                "type": "pose",
                "sequence": sequence,
                "timestamp": timestamp,
                "quaternion": quaternion
            ]
        case let .pan(dx, dy):
            return ["type": "pan", "dx": dx, "dy": dy]
        case let .zoom(scale):
            return ["type": "zoom", "scale": scale]
        case .recenter:
            return ["type": "recenter"]
        }
    }
}
