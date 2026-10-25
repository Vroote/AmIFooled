/**
 * Manual harness popup: the opt-in card bound to the real active tab.
 *
 * Like the production popup, this resolves the real active tab. It sends nothing;
 * predictable badge counts come from the background's fixture provider without HTTP.
 */

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';

import NavigationOptIn from '../../../../components/NavigationOptIn';
import { navigableHostname } from '../../../../lib/navigation';
import '../../../../styles/base.css';

function Harness() {
  const [hostname, setHostname] = useState<string | null>(null);
  const [note, setNote] = useState('Определяю активную вкладку…');

  useEffect(() => {
    let active = true;
    browser.tabs
      .query({ active: true, lastFocusedWindow: true })
      .then(([tab]) => {
        if (!active) {
          return;
        }
        const value = navigableHostname(tab?.url);
        setHostname(value);
        setNote(
          value
            ? `Активная вкладка: ${value}`
            : 'Активная вкладка не поддерживается — откройте обычную http(s)-страницу.',
        );
      })
      .catch(() => {
        if (active) {
          setNote('Не удалось прочитать активную вкладку.');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="popup">
      <header>
        <p className="brand">
          AmIFooled<span aria-hidden="true">?</span>
        </p>
        <h1>Navigation smoke</h1>
        <p className="overall" role="status">
          {note}
        </p>
        <p className="demo">
          Тестовая сборка для ручной проверки #7. Числа на бейдже синтетические: 2 для
          localhost, 0 для 127.0.0.1, «?» для любого другого сайта.
        </p>
      </header>
      <NavigationOptIn hostname={hostname} />
      <p className="footnote">
        Проверяется надёжность сайта, а не пользователя. На сервер уходит только имя сайта.
      </p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
