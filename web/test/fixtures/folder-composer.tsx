import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MentionComposer } from '../../src/components/mention-composer'
import '../../src/index.css'
function Fixture() {
  const [value, setValue] = useState('')
  return <><header style={{ position: 'fixed', top: 0, height: 48, width: '100%' }}>Navbar</header><main style={{ position: 'fixed', bottom: 0, width: '100%' }}><MentionComposer value={value} onChange={setValue} onSubmit={() => {}} placeholder="Message" /></main><output>{value}</output></>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
