import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { createRealController } from '../../lib/controller-real';
import '../../styles/base.css';

const controller = createRealController();
window.addEventListener('pagehide', () => controller.dispose?.());
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App controller={controller} />
  </StrictMode>,
);
