import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeErrorBody } from '../../../../src/core/forge/httpError';

test('describeErrorBody: an empty body has nothing to describe', () => {
  assert.equal(describeErrorBody(''), undefined);
  assert.equal(describeErrorBody('   '), undefined);
});

test('describeErrorBody: JSON with no recognizable message field has nothing to add', () => {
  assert.equal(describeErrorBody('{}'), undefined);
  assert.equal(describeErrorBody('[]'), undefined);
});

test('describeErrorBody: a top-level message field (GitLab, Azure DevOps)', () => {
  assert.equal(describeErrorBody(JSON.stringify({ message: 'Not found' })), 'Not found');
});

test('describeErrorBody: GitHub validation errors carry the real reason in errors[].message, not the generic top-level message', () => {
  const body = JSON.stringify({
    message: 'Validation Failed',
    errors: [{ resource: 'PullRequestReview', code: 'unprocessable', message: 'Can not approve your own pull request' }],
  });
  assert.equal(describeErrorBody(body), 'Validation Failed; Can not approve your own pull request');
});

test('describeErrorBody: a nested error.message (Bitbucket)', () => {
  assert.equal(describeErrorBody(JSON.stringify({ error: { message: 'Invalid request' } })), 'Invalid request');
});

test('describeErrorBody: a plain error_description (OAuth-style errors)', () => {
  assert.equal(describeErrorBody(JSON.stringify({ error: 'invalid_grant', error_description: 'Token expired' })), 'invalid_grant; Token expired');
});

test('describeErrorBody: a non-JSON body falls back to the raw text, capped in length', () => {
  assert.equal(describeErrorBody('Service Unavailable'), 'Service Unavailable');
  const long = 'x'.repeat(500);
  assert.equal(describeErrorBody(long), 'x'.repeat(300));
});
