import React from "react";
import ReactDOM from "react-dom/client";
import "./global.css";
import { getCurrentWindow } from "@tauri-apps/api/window";

const currentWindow = getCurrentWindow();
const windowLabel = currentWindow.label;

const render = (node: React.ReactNode) =>
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>{node}</React.StrictMode>
  );

// Each window loads only the code it renders.
if (windowLabel === "prompter") {
  Promise.all([import("./contexts"), import("./pages/prompter")]).then(
    ([{ ThemeProvider }, { default: Prompter }]) =>
      render(<ThemeProvider><Prompter /></ThemeProvider>)
  );
} else if (windowLabel.startsWith("capture-overlay-")) {
  const monitorIndex = parseInt(windowLabel.split("-")[2], 10) || 0;
  // Render overlay without providers
  import("./components/Overlay").then(({ default: Overlay }) =>
    render(<Overlay monitorIndex={monitorIndex} />)
  );
} else {
  Promise.all([import("./contexts"), import("./routes")]).then(
    ([{ AppProvider, ThemeProvider }, { default: AppRoutes }]) =>
      render(
        <ThemeProvider>
          <AppProvider>
            <AppRoutes />
          </AppProvider>
        </ThemeProvider>
      )
  );
}
