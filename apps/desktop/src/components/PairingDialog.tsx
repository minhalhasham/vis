import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { ControllerStatus } from "@molecvis/protocol";

interface PairingDialogProps {
  status: ControllerStatus;
  onClose(): void;
  onRetry(): void;
}

export function PairingDialog({ status, onClose, onRetry }: PairingDialogProps) {
  const [qrCode, setQrCode] = useState("");

  useEffect(() => {
    if (status.state !== "pairing") {
      setQrCode("");
      return;
    }
    void QRCode.toDataURL(status.pairUri, {
      width: 320,
      margin: 2,
      color: { dark: "#07111fff", light: "#f8fbffff" },
    }).then(setQrCode);
  }, [status]);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="pairing-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pair-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="icon-button close-button" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="eyebrow">IPHONE CONTROLLER</div>
        <h2 id="pair-title">
          {status.state === "connected" ? "Controller connected" : "Pair your phone"}
        </h2>

        {status.state === "pairing" && (
          <>
            <p>Open MolecVis Controller and scan this one-time code.</p>
            <div className="qr-frame">
              {qrCode ? <img src={qrCode} alt="MolecVis pairing QR code" /> : <div className="qr-loading" />}
            </div>
            <div className="network-address">
              Same Wi-Fi · {status.host}:{status.port}
            </div>
          </>
        )}

        {status.state === "connected" && (
          <div className="connected-state">
            <span className="connected-pulse" />
            <p>Move the phone to rotate. Use the touch surface to pan and pinch to zoom.</p>
          </div>
        )}

        {status.state === "error" && (
          <>
            <p className="error-copy">{status.message}</p>
            <button className="primary-button" onClick={onRetry}>Try again</button>
          </>
        )}

        {status.state === "idle" && (
          <>
            <p>The pairing session ended. Start a new session to generate a fresh code.</p>
            <button className="primary-button" onClick={onRetry}>New pairing code</button>
          </>
        )}
      </section>
    </div>
  );
}

