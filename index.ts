// Polyfills MUST be first — before any SDK imports
import './src/polyfills'

import { registerRootComponent } from 'expo'
import App from './App'

registerRootComponent(App)
