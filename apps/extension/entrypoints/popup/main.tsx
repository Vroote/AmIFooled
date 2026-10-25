import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { createDemoController, readScenario } from './controller';
import '../../styles/base.css';

// Issue #6 replaces this with the controller that talks to the collector and the API.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App controller={createDemoController(readScenario(location.search))} />
  </StrictMode>,
);
