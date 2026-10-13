import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// This app talks to Convex through its HTTP actions API (see convex/http.ts and
// src/lib/api.ts), so no ConvexReactClient/ConvexProvider is needed. Add one here
// if you later introduce queries or mutations.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
