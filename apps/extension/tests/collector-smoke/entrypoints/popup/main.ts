import { collectPageEvidence, type PolicyInput } from '../../../../lib/collector';

const output = document.querySelector<HTMLPreElement>('#result')!;
async function run(policy: PolicyInput) {
  output.textContent = 'Сбор…';
  const result = await collectPageEvidence(policy);
  output.textContent = JSON.stringify(result, null, 2);
  const summary = document.querySelector('#summary')!;
  const secretsPresent = /COOKIE_SECRET|fixtureSession|fixtureAccount|PRIVATE FORM CONTENT|PRIVATE VALUE|privacy@example\.com|fixture=secret/i.test(output.textContent);
  summary.textContent = `Fixture secrets: ${secretsPresent ? 'FAIL' : 'PASS'}. ` +
    (result.status === 'ready' ? `Policy length: ${result.payload.policy_text.length}. Policy: ${result.payload.policy_text.slice(0, 200)}` :
      result.status === 'needs_policy' ? `Needs policy: ${result.reason}` : `Error: ${result.code}`);
}
document.querySelector('#selection')!.addEventListener('click', () => void run({ source: 'selection' }));
document.querySelector('#manual')!.addEventListener('click', () => void run({
  source: 'manual', text: document.querySelector<HTMLTextAreaElement>('#policy')!.value,
}));
