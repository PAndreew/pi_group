import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import { registerServiceWorker } from "./hooks/use-run-notifications"
import "./index.css"

async function start() {
  const demo = import.meta.env.VITE_DEMO === "true"
  if (demo) {
    const { installDemoBackend } = await import("./demo/backend")
    installDemoBackend()
    if (!location.hash) history.replaceState(null, "", "#f=weekend-planner&s=pi%3Aplanner")
  } else registerServiceWorker()

  if (localStorage.getItem("pi-group:theme") === "dark" || (!localStorage.getItem("pi-group:theme") && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.documentElement.classList.add("dark")
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      {demo ? <div className="relative flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b bg-amber-100 px-3 py-1 text-center text-xs text-amber-950">Interactive demo · Fictional data · No commands execute</div>
        <div className="relative min-h-0 flex-1"><App /></div>
      </div> : <App />}
    </StrictMode>
  )
}

void start()
