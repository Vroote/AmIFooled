/**
 * Manual harness popup: the opt-in card bound to the real active tab.
 *
 * The production popup still receives its hostname from the demo controller of #5, so
 * its card reads demo.example. This harness asks the browser instead, which is what the
 * navigation scenario needs. It sends nothing by itself; the badge comes from the
 * background registration with the fixture provider.
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
