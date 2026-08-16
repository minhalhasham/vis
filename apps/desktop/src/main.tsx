import ReactDOM from "react-dom/client";
import "ketcher-react/dist/index.css";
import "./styles.css";
import { App } from "./App";

export function renderApplication(): void {
  ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
}
