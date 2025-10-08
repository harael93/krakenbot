// Central API base config for client
// Default to production host; can be overridden by Vite env VITE_API_BASE
const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE)
  ? import.meta.env.VITE_API_BASE
  : 'https://krakenbot.deployedlogic.site'

// Derived WebSocket base (ws/wss)
const WS_BASE = API_BASE.replace(/^http/, 'ws')

export { API_BASE, WS_BASE }
