import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MentionComposer } from '../../src/components/mention-composer'
import '../../src/index.css'
import { useAppViewport } from '../../src/hooks/use-app-viewport'
function Fixture() {
  const [value, setValue] = useState('')
  useAppViewport()
  return <><div style={{ position: 'fixed', top: 'var(--app-top, 0px)', height: 'var(--app-height, 100dvh)', width: '100%', display: 'flex', flexDirection: 'column' }}><header style={{ height: 48, flexShrink: 0 }}>Navbar</header><main style={{ marginTop: 'auto' }}><MentionComposer value={value} onChange={setValue} onSubmit={() => {}} placeholder="Message" /></main></div><output>{value}</output></>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
