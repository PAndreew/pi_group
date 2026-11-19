import { lazy, StrictMode, Suspense } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import { registerServiceWorker } from "./hooks/use-run-notifications"
import "./index.css"

const isDemo = import.meta.env.VITE_DEMO === "true"
const DemoApp = lazy(() => import("./demo/DemoApp"))
if (!isDemo) registerServiceWorker()

if (localStorage.getItem("pi-group:theme") === "dark" || (!localStorage.getItem("pi-group:theme") && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
  document.documentElement.classList.add("dark")
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isDemo ? <Suspense fallback={<p>Loading Beezy demo…</p>}><DemoApp /></Suspense> : <App />}
  </StrictMode>
)
