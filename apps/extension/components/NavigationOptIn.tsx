/**
 * The switch for checking this one site on open.
 *
 * Off by default. The card states what leaves the browser before anything is enabled,
 * and a refusal from Chrome is shown as a normal outcome, not as an error, because the
 * manual check above keeps working either way.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  disableSite as disableSiteDefault,
  enableSite as enableSiteDefault,
  hasSitePermission as hasSitePermissionDefault,
  isEnabled as isEnabledDefault,
  type EnableOutcome,
} from '../lib/navigation-optin';
import ActionButton from './ActionButton';

export interface OptInAdapter {
  isEnabled(hostname: string): Promise<boolean>;
  hasSitePermission(hostname: string): Promise<boolean>;
  enableSite(hostname: string): Promise<EnableOutcome>;
  disableSite(hostname: string): Promise<'disabled' | 'unavailable'>;
}

const defaultAdapter: OptInAdapter = {
  isEnabled: isEnabledDefault,
  hasSitePermission: hasSitePermissionDefault,
  enableSite: enableSiteDefault,
  disableSite: disableSiteDefault,
};

const ENABLE_NOTICE: Record<EnableOutcome, string | null> = {
  enabled: null,
  denied: 'Chrome не дал разрешение для этого сайта. Ручная проверка выше продолжает работать.',
  invalid: 'Для этой страницы автоматическая проверка недоступна.',
  limit: 'Список сайтов заполнен. Отключите автопроверку на другом сайте и повторите.',
  unavailable: 'Не удалось сохранить настройку. Попробуйте ещё раз.',
};

type Mode = 'off' | 'on' | 'revoked';

export default function NavigationOptIn({
  hostname,
  adapter = defaultAdapter,
}: {
  hostname: string | null;
  adapter?: OptInAdapter;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<Mode> => {
    if (!hostname) {
      return 'off';
    }
    if (!(await adapter.isEnabled(hostname))) {
      return 'off';
    }
    return (await adapter.hasSitePermission(hostname)) ? 'on' : 'revoked';
  }, [adapter, hostname]);

  useEffect(() => {
    let active = true;
    refresh()
      .then((value) => {
        if (active) {
          setMode(value);
        }
      })
      .catch(() => {
        if (active) {
          setMode('off');
        }
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  const enable = useCallback(() => {
    if (!hostname) {
      return;
    }
    setBusy(true);
    setNotice(null);
    adapter
      .enableSite(hostname)
      .then(async (outcome) => {
        setNotice(ENABLE_NOTICE[outcome]);
        setMode(await refresh());
      })
      .catch(() => setNotice(ENABLE_NOTICE.unavailable))
      .finally(() => setBusy(false));
  }, [adapter, hostname, refresh]);

  const disable = useCallback(() => {
    if (!hostname) {
      return;
    }
    setBusy(true);
    setNotice(null);
    adapter
      .disableSite(hostname)
      .then(async (outcome) => {
        setNotice(
          outcome === 'disabled'
            ? null
            : 'Не удалось полностью отключить. Разрешение можно убрать в chrome://extensions.',
        );
        setMode(await refresh());
      })
      .catch(() => setNotice(ENABLE_NOTICE.unavailable))
      .finally(() => setBusy(false));
  }, [adapter, hostname, refresh]);

  const status =
    mode === null
      ? 'Проверяю настройку…'
      : mode === 'on'
        ? 'Включено для этого сайта'
        : mode === 'revoked'
          ? 'Разрешение отозвано в настройках Chrome'
          : 'Выключено';

  return (
    <section className="card" aria-labelledby="autocheck-heading">
      <h2 id="autocheck-heading">Проверять этот сайт при открытии</h2>
      <p className="muted" role="status">
        {status}
        {hostname ? ` · ${hostname}` : ''}
      </p>

      <p className="muted">
        {hostname
          ? `При заходе на сайт на сервер уйдёт только его имя: ${hostname}. Адрес страницы, путь, параметры и содержимое не отправляются.`
          : 'Откройте обычную http(s)-страницу, чтобы включить автоматическую проверку.'}
      </p>
      <p className="muted">
        Бейдж на значке покажет число известных утечек сайта, «0» при отсутствии записей или
        «?», если число неизвестно. Ноль и «?» не означают, что сайт безопасен.
      </p>

      {notice ? (
        <p className="field__hint" role="status">
          {notice}
        </p>
      ) : null}

      {mode === 'on' ? (
        <ActionButton variant="secondary" onClick={disable} disabled={busy} busy={busy}>
          Отключить и убрать разрешение
        </ActionButton>
      ) : (
        <ActionButton
          variant="secondary"
          onClick={enable}
          disabled={busy || !hostname || mode === null}
          busy={busy}
        >
          {mode === 'revoked' ? 'Запросить разрешение снова' : 'Включить для этого сайта'}
        </ActionButton>
      )}
    </section>
  );
}
