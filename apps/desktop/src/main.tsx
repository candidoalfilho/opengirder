import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { useStore } from './store'
import './theme.css'

// hook de desenvolvimento: store acessível p/ verificação automatizada
if (import.meta.env.DEV) {
  ;(window as unknown as { __ogStore: typeof useStore }).__ogStore = useStore
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
