import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import BreachesCard from '../components/BreachesCard';
import AnalysisCard from '../components/AnalysisCard';
import type { BreachesResponse } from '../entrypoints/popup/state';

const unavailable: BreachesResponse = {
  hostname: 'example.com', matched_domain: 'example.com', status: 'unavailable', count: null,
  breaches: [], checked_at: '2026-10-25T10:00:00Z', source: 'hibp', stale: false,
  attribution_url: 'https://haveibeenpwned.com/',
};

it('unavailable card keeps attribution and retry without claiming no records exist', () => {
  const html = renderToStaticMarkup(createElement(BreachesCard, {
    state: { phase: 'ok', data: unavailable }, hostname: 'example.com', canCheck: true,
    onCheck: () => {},
  }));
  expect(html).toContain('Число известных утечек сейчас неизвестно');
  expect(html).not.toContain('В каталоге HIBP записей по этому домену нет');
  expect(html).toContain('Проверить заново');
  expect(html).toContain('https://haveibeenpwned.com/');
});

it('only a not_found response displays the no-match explanation', () => {
  const html = renderToStaticMarkup(createElement(BreachesCard, {
    state: { phase: 'ok', data: { ...unavailable, status: 'not_found', count: 0 } },
    hostname: 'example.com', canCheck: true, onCheck: () => {},
  }));
  expect(html).toContain('В каталоге HIBP записей по этому домену нет');
  expect(html).not.toContain('Число известных утечек сейчас неизвестно');
});

it('unavailable analysis does not claim a completed comparison found no differences', () => {
  const html = renderToStaticMarkup(createElement(AnalysisCard, {
    state: { phase: 'ok', data: {
      hostname: 'example.com', status: 'unavailable', mode: 'rules',
      summary: 'Источник недоступен.', findings: [], limitations: [],
    } }, evidence: [], canRetry: false, onRetry: () => {},
  }));
  expect(html).toContain('Результат сверки недоступен');
  expect(html).not.toContain('По текущим правилам расхождений нет');
});

it('labels a document-only warning as requiring attention rather than an observed discrepancy', () => {
  const html = renderToStaticMarkup(createElement(AnalysisCard, {
    state: { phase: 'ok', data: {
      hostname: 'example.com', status: 'insufficient_data', mode: 'llm',
      summary: 'Замечание относится только к документу.',
      findings: [{ title: 'Передача рекламным партнёрам', explanation: 'Уточните получателей.',
        severity: 'warning', policy_quote: 'Передаём данные рекламным партнёрам.', evidence_ids: [] }],
      limitations: ['Поведение сайта не проверено.'],
    } }, evidence: [], canRetry: false, onRetry: () => {},
  }));
  expect(html).toContain('Требует внимания');
  expect(html).not.toContain('Расхождение');
  expect(html).toContain('Поведение сайта не проверено');
});
