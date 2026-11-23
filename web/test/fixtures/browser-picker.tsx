import { createRoot } from "react-dom/client"
import { BrowserPanel } from "../../src/components/browser-panel"
import "../../src/index.css"

createRoot(document.getElementById("root")!).render(
  <BrowserPanel sessionKey="fixture" picks={0} onClose={() => {}}
    onPick={(ref) => Object.assign(window, { sessionPick: ref })}
    ask={{ replies: [], onSend: async (text, picks) => { Object.assign(window, { sent: { text, picks } }) } }}
  />,
)
