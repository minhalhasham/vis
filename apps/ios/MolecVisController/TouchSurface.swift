import SwiftUI

struct TouchSurface: View {
    @EnvironmentObject private var connection: ControllerConnection
    @State private var previousTranslation: CGSize = .zero
    @State private var previousMagnification: CGFloat = 1

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 28)
                .fill(.white.opacity(0.055))
            RoundedRectangle(cornerRadius: 28)
                .stroke(.white.opacity(0.1), lineWidth: 1)
            VStack(spacing: 8) {
                Image(systemName: "hand.draw")
                    .font(.system(size: 28, weight: .light))
                    .foregroundStyle(.mint)
                Text("DRAG TO PAN · PINCH TO ZOOM")
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .tracking(1.4)
                    .foregroundStyle(.secondary)
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: 28))
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    let dx = value.translation.width - previousTranslation.width
                    let dy = value.translation.height - previousTranslation.height
                    previousTranslation = value.translation
                    connection.sendPan(dx: dx, dy: dy)
                }
                .onEnded { _ in previousTranslation = .zero }
        )
        .simultaneousGesture(
            MagnificationGesture()
                .onChanged { value in
                    let relative = value / previousMagnification
                    previousMagnification = value
                    connection.sendZoom(scale: relative)
                }
                .onEnded { _ in previousMagnification = 1 }
        )
        .accessibilityLabel("Molecule pan and zoom surface")
    }
}

