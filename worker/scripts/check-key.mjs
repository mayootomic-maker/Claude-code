/**
 * Proves an OJP credential actually authenticates, without it ever being
 * pasted into a chat or committed.
 *
 * Reads the key from the environment or worker/.dev.vars (both gitignored),
 * makes one real request, and reports what came back. The point is to
 * distinguish the three outcomes that look similar from the portal UI:
 *
 *   401 / 403  the credential is wrong — you took the hash, or it is not
 *              yet approved
 *   400        the credential is GOOD; the request body is what upset it
 *   200        the credential is good and the request was accepted
 *
 * Run:  node scripts/check-key.mjs
 */

import { readFile } from 'node:fs/promises'

const ENDPOINT = 'https://api.opentransportdata.swiss/ojp20'

async function readKey() {
  if (process.env.OJP_API_KEY !== undefined && process.env.OJP_API_KEY !== '') {
    return { key: process.env.OJP_API_KEY, from: 'environment' }
  }
  try {
    const text = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8')
    for (const line of text.split('\n')) {
      const match = /^\s*OJP_API_KEY\s*=\s*(.+?)\s*$/.exec(line)
      if (match?.[1] !== undefined && !match[1].startsWith('paste-your')) {
        return { key: match[1].replace(/^["']|["']$/g, ''), from: 'worker/.dev.vars' }
      }
    }
  } catch {
    // Falls through to the guidance below.
  }
  return null
}

function stopEventRequest(stopId) {
  const now = new Date().toISOString()
  return `<?xml version="1.0" encoding="UTF-8"?>
<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0">
  <OJPRequest>
    <siri:ServiceRequest>
      <siri:RequestTimestamp>${now}</siri:RequestTimestamp>
      <siri:RequestorRef>pendlo-solo</siri:RequestorRef>
      <OJPStopEventRequest>
        <siri:RequestTimestamp>${now}</siri:RequestTimestamp>
        <Location>
          <PlaceRef><StopPlaceRef>${stopId}</StopPlaceRef></PlaceRef>
          <DepArrTime>${now}</DepArrTime>
        </Location>
        <Params>
          <NumberOfResults>2</NumberOfResults>
          <StopEventType>departure</StopEventType>
          <IncludeRealtimeData>true</IncludeRealtimeData>
        </Params>
      </OJPStopEventRequest>
    </siri:ServiceRequest>
  </OJPRequest>
</OJP>`
}

const found = await readKey()
if (found === null) {
  console.error('No OJP_API_KEY found.\n')
  console.error('Put it in worker/.dev.vars (gitignored):')
  console.error('  cp .dev.vars.example .dev.vars   # then edit it')
  console.error('or run with:  OJP_API_KEY=... node scripts/check-key.mjs')
  process.exit(1)
}

// Never print the key itself, only enough to tell two candidates apart.
const fingerprint = `${found.key.slice(0, 4)}…${found.key.slice(-4)} (${found.key.length} chars)`
console.log(`Using key from ${found.from}: ${fingerprint}\n`)

const response = await fetch(ENDPOINT, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${found.key}`,
    'content-type': 'application/xml',
    // The portal docs require a User-Agent; requests without one are rejected.
    'user-agent': 'pendlo-solo/1.0',
  },
  body: stopEventRequest('8502113'),
}).catch((error) => {
  console.error(`Network error: ${error.message}`)
  process.exit(1)
})

const body = await response.text()
console.log(`HTTP ${response.status}\n`)

if (response.status === 401 || response.status === 403) {
  console.log('✗ The credential was REJECTED.')
  console.log('  Most likely you copied the token *hash* rather than the token,')
  console.log('  or the access request is still pending approval.')
} else if (response.status === 400) {
  console.log('✓ The credential AUTHENTICATED.')
  console.log('  A 400 means the key was accepted and only the request body was')
  console.log('  rejected — which is all this check needed to establish.')
} else if (response.ok) {
  console.log('✓ The credential AUTHENTICATED and the request was accepted.')
  const stops = body.match(/<StopPointName>[\s\S]*?<\/StopPointName>/g)?.length ?? 0
  console.log(`  Response is ${body.length} bytes, ${stops} stop names.`)
} else {
  console.log('? Unexpected status — see the response below.')
}

console.log(`\n--- first 400 bytes of response ---\n${body.slice(0, 400)}`)
