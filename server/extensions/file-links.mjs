// Loaded only by beezy's pi RPC adapter. Beezy's chat turns relative markdown links into in-app file previews.
const guidance = `

## Linking files in beezy
Your replies are shown in beezy, a web chat that previews files from the shared folder. Whenever you create or substantially change a file the user may want to look at (documents, reports, images, data, code), end your reply with a markdown link to it whose target is the path relative to your working directory, e.g. [report.md](report.md) or [chart.png](out/chart.png). Use forward slashes and do not use absolute paths, file:// URLs or backticks around the link.`

export default function (pi) {
  pi.on("before_agent_start", async (event) => ({ systemPrompt: event.systemPrompt + guidance }))
}
