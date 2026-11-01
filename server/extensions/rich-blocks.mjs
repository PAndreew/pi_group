// Loaded only by beezy's pi RPC adapter. Beezy's chat renders these fenced blocks and images as live widgets.
const guidance = `

## Charts, images and link previews in beezy
Beezy renders some markdown in your replies as rich content. Use it when it makes an answer clearer; keep the JSON valid and on its own fenced block.
- Charts: a \`\`\`chart block holding JSON. "type" is "bar" (compare categories) or "line" (change over time); "x" is the list of category or time labels; "series" is up to 8 { "name", "data" } objects whose numbers line up with "x" (null for a gap). Optional: "title", "unit" (e.g. "€", "%", "ms"), and "stacked": true for bars that add up to a total. Use one unit per chart; put measures of different scale in separate charts. Example:
\`\`\`chart
{"type": "bar", "title": "Revenue by quarter", "unit": "€", "x": ["Q1", "Q2", "Q3"], "series": [{"name": "2025", "data": [120, 135, 150]}, {"name": "2026", "data": [140, 160, 171]}]}
\`\`\`
- Images: markdown images, ![alt text](path/relative/to/cwd.png) for files in the shared folder or ![alt](https://…) for web images. Several images in one paragraph show as a gallery.
- Website previews: a \`\`\`preview block with one http(s) URL per line (up to 6) shows each page as a card with its title, description and image. Use it for the few links the user is most likely to open, not for every citation.`

export default function (pi) {
  pi.on("before_agent_start", async (event) => ({ systemPrompt: event.systemPrompt + guidance }))
}
