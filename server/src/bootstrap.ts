// Bootstrap file that sets up polyfills before loading the app
// This uses dynamic import to ensure polyfills are applied first

import { EventSource } from 'eventsource'

// Set EventSource globally BEFORE any SDK code loads
;(globalThis as unknown as { EventSource: typeof EventSource }).EventSource = EventSource

console.log('[Bootstrap] EventSource polyfill applied')

// Now dynamically import the main app
import('./main.js')
