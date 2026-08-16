import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var connection: ControllerConnection
    @EnvironmentObject private var motion: MotionController
    @State private var showingScanner = false
    @State private var scannerError: String?

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(red: 0.025, green: 0.065, blue: 0.12), Color(red: 0.04, green: 0.12, blue: 0.19)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ).ignoresSafeArea()

            VStack(spacing: 22) {
                header
                connectionCard

                if connection.state == .connected {
                    TouchSurface()
                        .frame(maxHeight: .infinity)
                    controls
                } else {
                    pairingPrompt
                        .frame(maxHeight: .infinity)
                }

                if let reason = motion.unavailableReason {
                    Text(reason).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
                }
            }
            .padding(20)
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showingScanner) {
            ZStack(alignment: .topTrailing) {
                QRScannerView(
                    onCode: { code in
                        showingScanner = false
                        connection.connect(pairingURI: code)
                    },
                    onFailure: { message in
                        showingScanner = false
                        scannerError = message
                    }
                )
                Button("Cancel") { showingScanner = false }
                    .buttonStyle(.borderedProminent)
                    .tint(.black.opacity(0.55))
                    .padding()
            }
            .ignoresSafeArea()
        }
        .alert("Unable to scan", isPresented: Binding(
            get: { scannerError != nil },
            set: { if !$0 { scannerError = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(scannerError ?? "Unknown camera error")
        }
        .onChange(of: connection.state) { state in
            if state != .connected { motion.stop() }
            if state == .connected { motion.start() }
        }
    }

    private var header: some View {
        HStack {
            Image(systemName: "atom")
                .font(.system(size: 28, weight: .light))
                .foregroundStyle(.mint)
            VStack(alignment: .leading, spacing: 2) {
                Text("MolecVis").font(.title3.bold())
                Text("MOTION CONTROLLER")
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .tracking(1.7)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
    }

    private var connectionCard: some View {
        HStack(spacing: 11) {
            Circle()
                .fill(connectionColor)
                .frame(width: 9, height: 9)
                .shadow(color: connectionColor.opacity(0.8), radius: 7)
            VStack(alignment: .leading, spacing: 2) {
                Text(connectionTitle).font(.subheadline.weight(.semibold))
                if case .failed(let message) = connection.state {
                    Text(message).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            Spacer()
            if connection.state == .connected {
                Button("Disconnect") { connection.disconnect() }
                    .font(.caption.weight(.semibold))
            }
        }
        .padding(15)
        .background(.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 16))
    }

    private var pairingPrompt: some View {
        VStack(spacing: 18) {
            Image(systemName: "qrcode.viewfinder")
                .font(.system(size: 66, weight: .ultraLight))
                .foregroundStyle(.mint)
            Text("Pair with your PC")
                .font(.system(size: 27, weight: .medium, design: .serif))
            Text("Select Pair iPhone in MolecVis on your PC, then scan its one-time code.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 18)
            Button {
                showingScanner = true
            } label: {
                Label("Scan pairing code", systemImage: "camera.viewfinder")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.mint)
            .foregroundStyle(Color(red: 0.02, green: 0.08, blue: 0.12))
            .controlSize(.large)
        }
    }

    private var controls: some View {
        HStack(spacing: 12) {
            Button {
                motion.toggle()
            } label: {
                Label(motion.isRunning ? "Pause motion" : "Start motion", systemImage: motion.isRunning ? "pause.fill" : "play.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)

            Button {
                motion.recenter()
            } label: {
                Label("Recenter", systemImage: "scope")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.mint)
            .foregroundStyle(Color(red: 0.02, green: 0.08, blue: 0.12))
        }
        .controlSize(.large)
    }

    private var connectionTitle: String {
        switch connection.state {
        case .disconnected: "Not connected"
        case .connecting: "Connecting…"
        case .connected: "Connected to MolecVis"
        case .failed: "Connection failed"
        }
    }

    private var connectionColor: Color {
        switch connection.state {
        case .connected: .mint
        case .connecting: .yellow
        case .failed: .red
        case .disconnected: .gray
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(ControllerConnection())
        .environmentObject(MotionController())
}

