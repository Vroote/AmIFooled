/** Plain-language text for every machine state. Unknown is never worded as safe. */

import type { RequestFailure } from '../entrypoints/popup/state';

export const FAILURE_TEXT: Record<RequestFailure['kind'], string> = {
  page_changed: 'Страница или подключение изменились. Откройте проверку заново.',
  unsupported_page: 'Эту страницу нельзя проверить. Откройте обычный HTTP(S)-сайт.',
  offline: 'Нет сети. Проверка не выполнена — это не результат «всё чисто».',
  timeout: 'Проверка не успела завершиться. Результата нет.',
  not_implemented: 'Эта часть сервиса ещё не включена на сервере.',
  invalid_request: 'Сервер отклонил запрос: текст политики пустой или слишком длинный.',
  too_large: 'Текст слишком большой для одной проверки. Отправьте нужный раздел политики.',
  server: 'Сервер ответил ошибкой. Результата нет.',
  malformed: 'Ответ сервера не удалось прочитать. Результата нет.',
  unknown: 'Проверка не удалась. Результата нет.',
};

export const UNSUPPORTED_TEXT = {
  changed: 'Страница или подключение изменились. Обновите контекст проверки перед отправкой.',
  restricted: 'Это служебная страница браузера — расширение не может её читать.',
  scheme: 'Проверка работает только на страницах http(s).',
  'no-tab': 'Активная вкладка не найдена. Откройте сайт и запустите проверку снова.',
} as const;

export const ANALYSIS_STATUS_TEXT = {
  ok: 'Сверка выполнена',
  insufficient_data: 'Данных недостаточно',
  unavailable: 'Сверка недоступна',
} as const;

export const ANALYSIS_MODE_TEXT = {
  rules: 'правила',
  llm: 'правила и языковая модель',
  fixture: 'демо-данные',
} as const;

export const SEVERITY_TEXT = {
  warning: 'Требует внимания',
  info: 'К сведению',
} as const;

export const OVERALL_TEXT = {
  'page-loading': 'Определяю открытый сайт…',
  unsupported: 'На этой странице проверка недоступна',
  idle: 'Готово к проверке. Ничего ещё не отправлено.',
  working: 'Выполняю проверку…',
  ready: 'Проверки завершены',
  partial: 'Часть проверок не удалась — результат неполный',
  failed: 'Проверки не удались',
} as const;

export function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString('ru-RU', { dateStyle: 'long' });
}
