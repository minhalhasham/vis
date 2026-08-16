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
        socket.resume()
        send([
            "type": "hello",
            "protocolVersion": payload.protocolVersion,
            "token": payload.token,
            "client": "ios"
        ])
        receiveNext()
    }

    func disconnect() {
        socket?.cancel(with: .goingAway, reason: nil)
        session?.invalidateAndCancel()
        socket = nil
        session = nil
        state = .disconnected
    }

    func sendPose(sequence: Int, timestamp: Double, x: Double, y: Double, z: Double, w: Double) {
        guard state == .connected else { return }
        send([
            "type": "pose",
            "sequence": sequence,
            "timestamp": timestamp,
            "quaternion": [x, y, z, w]
        ])
    }

    func sendPan(dx: Double, dy: Double) {
        guard state == .connected else { return }
        send(["type": "pan", "dx": dx, "dy": dy])
    }

    func sendZoom(scale: Double) {
        guard state == .connected else { return }
        send(["type": "zoom", "scale": min(max(scale, 0.1), 9.9)])
    }

    func sendRecenter() {
        guard state == .connected else { return }
        send(["type": "recenter"])
    }

    private func send(_ object: [String: Any]) {
        guard let socket,
              let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else { return }
        socket.send(.string(text)) { [weak self] error in
            guard let error else { return }
            Task { @MainActor in self?.state = .failed(error.localizedDescription) }
        }
    }

    private func receiveNext() {
        socket?.receive { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                switch result {
                case .failure(let error):
                    self.state = .failed(error.localizedDescription)
                case .success(let message):
                    self.handle(message)
                    if self.socket != nil { self.receiveNext() }
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
}

