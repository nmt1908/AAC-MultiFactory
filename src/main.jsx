import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Dynamic Branding (CH / VG)
const appTitle = import.meta.env.VITE_APP_TITLE || 'AAC - AI Assist CCTV';
const appLogo = (import.meta.env.BASE_URL + (import.meta.env.VITE_APP_LOGO || 'logo_ch.png')).replace(/\/\//g, '/');

document.title = appTitle;
const favicon = document.querySelector('link[rel="icon"]');
if (favicon) {
  favicon.href = appLogo;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
