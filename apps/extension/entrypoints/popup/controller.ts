/**
 * The seam between the popup and everything outside it.
 *
 * The popup never touches fetch, tabs, or the collector directly: issue #6 supplies a
 * real controller, and until then the demo controller below returns clearly labelled
 * synthetic data for a reserved example domain. No real service is described by it.
 */

import type {
  AnalysisResponse,
  BreachesResponse,
  Evidence,
  PreparedContext,
  RequestFailure,
  RequestFailureKind,
} from './state';

export interface AnalyzeInput {
  hostname: string;
  policyText: string;
  evidence: Evidence[];
}

export interface PopupController {
  /** Resolve the active tab and whatever bounded facts may be sent with the policy. */
  prepare(): Promise<PreparedContext>;
  /** Optional: read the policy the user opened, for the user to review before sending. */
  readPolicyFromPage?(): Promise<string | null>;
  analyze(input: AnalyzeInput, signal: AbortSignal): Promise<AnalysisResponse>;
  checkBreaches(hostname: string, signal: AbortSignal): Promise<BreachesResponse>;
  /** True while the popup shows synthetic data instead of a real check. */
  readonly demo: boolean;
}

export class RequestError extends Error {
  readonly failure: RequestFailure;

  constructor(failure: RequestFailure) {
    super(`request failed: ${failure.kind}`);
    this.name = 'RequestError';
    this.failure = failure;
  }
}

/** Maps a transport outcome onto the kinds the popup knows how to explain. */
export function classify(status: number | undefined, cause?: unknown): RequestFailure {
  if (status === 501) {
    return { kind: 'not_implemented', status };
  }
  if (status === 413) {
    return { kind: 'too_large', status };
  }
  if (status === 422 || status === 400) {
    return { kind: 'invalid_request', status };
  }
  if (status !== undefined && status >= 500) {
    return { kind: 'server', status };
  }
  if (status !== undefined && status >= 400) {
    return { kind: 'unknown', status };
  }
  if (cause instanceof DOMException && cause.name === 'AbortError') {
    return { kind: 'timeout' };
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { kind: 'offline' };
  }
  if (cause instanceof SyntaxError) {
    return { kind: 'malformed' };
  }
  return { kind: 'unknown' };
}

export const RETRYABLE_KINDS: readonly RequestFailureKind[] = [
  'offline',
  'timeout',
  'server',
  'malformed',
  'unknown',
];

export function isRetryable(failure: RequestFailure): boolean {
  return RETRYABLE_KINDS.includes(failure.kind);
}

const DEMO_HOSTNAME = 'demo.example';

const DEMO_EVIDENCE: Evidence[] = [
  {
    id: 'demo-resource-1',
    kind: 'resource_domain',
    value: 'metrics.demo-analytics.example',
    limitation: 'Сторонний ресурс сам по себе не доказывает передачу персональных данных.',
  },
  {
    id: 'demo-cookie-1',
    kind: 'visible_cookie_count',
    value: '6',
    limitation: 'Видны только cookie, доступные JavaScript: HttpOnly в это число не попадают.',
  },
];

const DEMO_POLICY = [
  'Демонстрационная политика вымышленного сервиса demo.example.',
  'Мы не передаём данные третьим лицам.',
  'Документ не упоминает иные технологии хранения.',
].join(' ');

const DEMO_ANALYSIS: AnalysisResponse = {
  hostname: DEMO_HOSTNAME,
  status: 'ok',
  mode: 'fixture',
  summary:
    'Нашлось 2 расхождения между тем, что обещает политика, и тем, что видно на странице. ' +
    'Каждое расхождение — повод проверить, не доказанное нарушение.',
  findings: [
    {
      title: 'Обещание не передавать данные и сторонние ресурсы на странице',
      explanation:
        'Политика утверждает, что данные не передаются третьим лицам, а страница обращается ' +
        'к сторонним доменам. Стоит выяснить назначение этих ресурсов.',
      severity: 'warning',
      policy_quote: 'Мы не передаём данные третьим лицам',
      evidence_ids: ['demo-resource-1'],
    },
    {
      title: 'Cookie есть на странице, но в политике не упомянуты',
      explanation:
        'JavaScript видит 6 cookie, а переданный текст политики ни разу не упоминает cookie. ' +
        'Возможно, это другой раздел документа — проверьте полную версию политики.',
      severity: 'warning',
      policy_quote: '',
      evidence_ids: ['demo-cookie-1'],
    },
  ],
  limitations: [
    'Это синтетические демо-данные для вымышленного сервиса, не результат проверки сайта.',
    'Отсутствие сигнала не означает, что сайт безопасен.',
  ],
};

const DEMO_BREACHES: BreachesResponse = {
  hostname: DEMO_HOSTNAME,
  matched_domain: DEMO_HOSTNAME,
  status: 'ok',
  count: 1,
  breaches: [
    {
      name: 'DemoServiceSynthetic',
      title: 'Demo Service (синтетическая запись)',
      breach_date: '2024-03-11',
      data_classes: ['Email addresses', 'Passwords'],
      is_verified: true,
      source_url: 'https://haveibeenpwned.com/PwnedWebsites',
    },
  ],
  checked_at: '2026-10-25T10:00:00Z',
  source: 'fixture',
  stale: false,
  attribution_url: 'https://haveibeenpwned.com/',
};

const DEMO_EMPTY_ANALYSIS: AnalysisResponse = {
  hostname: DEMO_HOSTNAME,
  status: 'insufficient_data',
  mode: 'fixture',
  summary:
    'Наблюдений со страницы нет, поэтому сверить обещания политики с поведением сайта ' +
    'не удалось.',
  findings: [],
  limitations: [
    'Это синтетические демо-данные для вымышленного сервиса, не результат проверки сайта.',
  ],
};

const DEMO_EMPTY_BREACHES: BreachesResponse = {
  ...DEMO_BREACHES,
  status: 'not_found',
  count: 0,
  breaches: [],
  stale: true,
};

/**
 * Demo-only scenario switch, read from the popup URL.
 *
 * It exists so every state can be opened in a real browser for review and for the #8
 * acceptance matrix without a backend. It lives in the demo controller and disappears
 * together with it when #6 wires the real one.
 */
export type DemoScenario =
  | 'ok'
  | 'empty'
  | 'analysis-error'
  | 'breaches-error'
  | 'both-error'
  | 'unsupported';

export function readScenario(search: string): DemoScenario {
  const value = new URLSearchParams(search).get('demo');
  const known: DemoScenario[] = [
    'ok',
    'empty',
    'analysis-error',
    'breaches-error',
    'both-error',
    'unsupported',
  ];
  return known.find((item) => item === value) ?? 'ok';
}

function delay<T>(value: T, signal: AbortSignal, ms = 450): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(value), ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new RequestError({ kind: 'timeout' }));
    });
  });
}

function fail<T>(failure: RequestFailure, signal: AbortSignal): Promise<T> {
  return delay(null, signal, 450).then(() => {
    throw new RequestError(failure);
  });
}

/** Stands in for #6 so every state can be exercised without a backend. */
export function createDemoController(scenario: DemoScenario = 'ok'): PopupController {
  const empty = scenario === 'empty';
  return {
    demo: true,
    async prepare() {
      if (scenario === 'unsupported') {
        return { page: { status: 'unsupported', reason: 'restricted' }, evidence: [] };
      }
      return {
        page: { status: 'ready', hostname: DEMO_HOSTNAME },
        evidence: empty ? [] : DEMO_EVIDENCE,
      };
    },
    async readPolicyFromPage() {
      return DEMO_POLICY;
    },
    async analyze(_input, signal) {
      if (scenario === 'analysis-error' || scenario === 'both-error') {
        return fail({ kind: 'server', status: 503 }, signal);
      }
      return delay(empty ? DEMO_EMPTY_ANALYSIS : DEMO_ANALYSIS, signal);
    },
    async checkBreaches(_hostname, signal) {
      if (scenario === 'breaches-error' || scenario === 'both-error') {
        return fail({ kind: 'offline' }, signal);
      }
      return delay(empty ? DEMO_EMPTY_BREACHES : DEMO_BREACHES, signal);
    },
  };
}
