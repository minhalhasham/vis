import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as $3Dmol from "3dmol";
import type { ControllerEvent, PoseMessage, QuaternionTuple } from "@molecvis/protocol";
import {
  mapDeviceQuaternionToViewer,
  multiplyQuaternion,
  quaternionAngularDistance,
  relativeQuaternion,
  smoothingAmount,
  slerpQuaternion,
} from "../lib/motion";

type ViewerStyle = "ball-stick" | "spacefill";

export interface MoleculeViewerHandle {
  loadMolfile(molfile: string): void;
  resetView(): void;
  applyControllerEvent(event: ControllerEvent): void;
  setControllerConnected(connected: boolean): void;
}

interface MoleculeViewerProps {
  style: ViewerStyle;
  showHydrogens: boolean;
}

const identity: QuaternionTuple = [0, 0, 0, 1];
const motionSmoothingTimeMs = 40;
const settledAngleRadians = 0.001;

export const MoleculeViewer = forwardRef<MoleculeViewerHandle, MoleculeViewerProps>(
  function MoleculeViewer({ style, showHydrogens }, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<$3Dmol.GLViewer | null>(null);
    const molfileRef = useRef("");
    const baselinePhone = useRef<QuaternionTuple | null>(null);
    const baselineViewer = useRef<QuaternionTuple>(identity);
    const currentQuaternion = useRef<QuaternionTuple>(identity);
    const targetQuaternion = useRef<QuaternionTuple>(identity);
    const phoneDriving = useRef(false);
    const lastSequence = useRef(-1);
    const animationFrame = useRef<number>();
    const lastFrameTime = useRef<number | null>(null);
    const [hasMolecule, setHasMolecule] = useState(false);

    const applyStyle = () => {
      const viewer = viewerRef.current;
      if (!viewer || !molfileRef.current) return;
      viewer.setStyle({}, {});
      if (!showHydrogens) {
        viewer.setStyle(
          { elem: "H" },
          { line: { hidden: true }, stick: { hidden: true }, sphere: { hidden: true } },
        );
      }
      viewer.setStyle(
        showHydrogens ? {} : { not: { elem: "H" } },
        style === "spacefill"
          ? { sphere: { scale: 0.92 } }
          : { stick: { radius: 0.15 }, sphere: { scale: 0.28 } },
      );
      viewer.render();
    };

    useEffect(() => {
      if (!hostRef.current) return;
      const viewer = $3Dmol.createViewer(hostRef.current, {
        backgroundColor: "#07111f",
        antialias: true,
      });
      viewerRef.current = viewer;

      const observer = new ResizeObserver(() => viewer.resize());
      observer.observe(hostRef.current);

      const animate = (timestamp: number) => {
        const previousTimestamp = lastFrameTime.current ?? timestamp;
        const deltaMs = timestamp - previousTimestamp;
        lastFrameTime.current = timestamp;

        if (
          phoneDriving.current &&
          quaternionAngularDistance(currentQuaternion.current, targetQuaternion.current) > settledAngleRadians
        ) {
          const amount = smoothingAmount(deltaMs, motionSmoothingTimeMs);
          const interpolated = slerpQuaternion(
            currentQuaternion.current,
            targetQuaternion.current,
            amount,
          );
          const next = quaternionAngularDistance(interpolated, targetQuaternion.current) <= settledAngleRadians
            ? targetQuaternion.current
            : interpolated;
          currentQuaternion.current = next;
          const view = viewer.getView();
          view[4] = next[0];
          view[5] = next[1];
          view[6] = next[2];
          view[7] = next[3];
          viewer.setView(view);
        }
        animationFrame.current = requestAnimationFrame(animate);
      };
      animationFrame.current = requestAnimationFrame(animate);

      return () => {
        observer.disconnect();
        if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
        viewerRef.current = null;
      };
    }, []);

    useEffect(applyStyle, [style, showHydrogens]);

    const consumePose = (event: PoseMessage) => {
      if (event.sequence <= lastSequence.current) return;
      lastSequence.current = event.sequence;
      if (!baselinePhone.current) {
        baselinePhone.current = event.quaternion;
        const view = viewerRef.current?.getView();
        baselineViewer.current = view
          ? ([view[4], view[5], view[6], view[7]] as QuaternionTuple)
          : identity;
        currentQuaternion.current = baselineViewer.current;
        targetQuaternion.current = baselineViewer.current;
        phoneDriving.current = true;
        return;
      }
      const relative = mapDeviceQuaternionToViewer(
        relativeQuaternion(baselinePhone.current, event.quaternion),
      );
      targetQuaternion.current = multiplyQuaternion(baselineViewer.current, relative);
    };

    useImperativeHandle(ref, () => ({
      loadMolfile(molfile: string) {
        const viewer = viewerRef.current;
        if (!viewer) return;
        viewer.removeAllModels();
        viewer.addModel(molfile, "mol");
        molfileRef.current = molfile;
        setHasMolecule(true);
        applyStyle();
        viewer.zoomTo();
        const view = viewer.getView();
        currentQuaternion.current = [view[4], view[5], view[6], view[7]];
        targetQuaternion.current = currentQuaternion.current;
        baselinePhone.current = null;
        phoneDriving.current = false;
      },
      resetView() {
        const viewer = viewerRef.current;
        if (!viewer || !molfileRef.current) return;
        viewer.zoomTo();
        const view = viewer.getView();
        currentQuaternion.current = [view[4], view[5], view[6], view[7]];
        targetQuaternion.current = currentQuaternion.current;
        baselinePhone.current = null;
        phoneDriving.current = false;
      },
      applyControllerEvent(event) {
        const viewer = viewerRef.current;
        if (!viewer) return;
        if (event.type === "pose") {
          consumePose(event);
        } else if (event.type === "recenter") {
          baselinePhone.current = null;
          lastSequence.current = -1;
          phoneDriving.current = false;
        } else if (event.type === "pan") {
          const view = viewer.getView();
          view[0] += event.dx * 0.018;
          view[1] -= event.dy * 0.018;
          viewer.setView(view);
        } else if (event.type === "zoom") {
          viewer.zoom(event.scale);
        }
      },
      setControllerConnected(connected) {
        if (connected) return;
        phoneDriving.current = false;
        baselinePhone.current = null;
        lastSequence.current = -1;
        const view = viewerRef.current?.getView();
        if (view) {
          currentQuaternion.current = [view[4], view[5], view[6], view[7]];
          targetQuaternion.current = currentQuaternion.current;
        }
      },
    }));

    return (
      <section className="viewer-pane" aria-label="3D molecule viewer">
        <div ref={hostRef} className="viewer-canvas" />
        {!hasMolecule && (
          <div className="viewer-empty">
            <div className="orbital-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <h2>Your molecule, in motion</h2>
            <p>Draw a structure on the left, then select Generate 3D.</p>
          </div>
        )}
      </section>
    );
  },
);
