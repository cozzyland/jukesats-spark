// Bootstrap file — entry point for the server
export {}
const { start } = await import('./main.js')
await start()
