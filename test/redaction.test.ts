import assert from 'node:assert/strict';
import test from 'node:test';
import { Redactor } from '../src/redaction.js';

test('redacts structured secrets and credential query parameters without mutating input', () => {
  const original = {
    authorization: 'Bearer auth-secret',
    nested: { apiKey: 'api-secret', label: 'safe' },
    requestUrl: 'https://example.test/path?access_token=url-secret&view=compact',
    headers: [{ name: 'cookie', value: 'session=secret-cookie' }],
    profile: { email: 'person@example.test' },
  };
  const redactor = new Redactor();
  const redacted = redactor.redact(original);

  assert.equal(redacted.authorization, '[REDACTED]');
  assert.equal(redacted.nested.apiKey, '[REDACTED]');
  assert.equal(redacted.nested.label, 'safe');
  assert.doesNotMatch(redacted.requestUrl, /url-secret/);
  assert.match(redacted.requestUrl, /view=compact/);
  assert.equal(redacted.headers[0]?.value, '[REDACTED]');
  assert.equal(redacted.profile.email, '[REDACTED]');
  assert.equal(original.authorization, 'Bearer auth-secret');
  assert.deepEqual(redactor.summary(), {
    policyVersion: '1.0.0',
    replacement: '[REDACTED]',
    redactedValues: 5,
    categories: ['authorization', 'cookie', 'credential', 'personal_data', 'token'],
  });
});

test('redacts bearer credentials embedded in an otherwise unlabelled string', () => {
  const redactor = new Redactor();
  const output = redactor.redact('request failed for Bearer raw-token');
  assert.equal(output, 'request failed for Bearer [REDACTED]');
  assert.equal(redactor.summary().redactedValues, 1);
});
