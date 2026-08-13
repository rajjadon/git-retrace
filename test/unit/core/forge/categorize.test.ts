import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorizePullRequests } from '../../../../src/core/forge/categorize';
import type { ForgeRepoRef, PullRequestSummary } from '../../../../src/core/forge/types';

const REPO: ForgeRepoRef = { host: 'github', identity: 'acme/widgets', label: 'acme/widgets' };
const ME = 'raj';

function pr(overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    repo: REPO,
    number: 1,
    title: 'a change',
    url: 'https://github.com/acme/widgets/pull/1',
    authorLogin: ME,
    isDraft: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    requestedReviewers: [],
    checkStatus: 'passing',
    reviewDecision: 'approved',
    hasConflicts: false,
    ...overrides,
  };
}

const neverSnoozed = () => false;

test('categorizePullRequests: a snoozed PR always lands in "snoozed", regardless of any other state', () => {
  const result = categorizePullRequests(
    [pr({ isDraft: true, checkStatus: 'failing' })],
    ME,
    () => true,
  );
  assert.equal(result[0]?.bucket, 'snoozed');
});

test('categorizePullRequests: a draft is always "drafts", even with failing checks or conflicts', () => {
  const result = categorizePullRequests(
    [pr({ isDraft: true, checkStatus: 'failing', hasConflicts: true })],
    ME,
    neverSnoozed,
  );
  assert.equal(result[0]?.bucket, 'drafts');
});

test('categorizePullRequests: failing checks land in "blocked"', () => {
  const result = categorizePullRequests([pr({ checkStatus: 'failing' })], ME, neverSnoozed);
  assert.equal(result[0]?.bucket, 'blocked');
});

test('categorizePullRequests: changes requested lands in "blocked"', () => {
  const result = categorizePullRequests([pr({ reviewDecision: 'changesRequested' })], ME, neverSnoozed);
  assert.equal(result[0]?.bucket, 'blocked');
});

test('categorizePullRequests: merge conflicts land in "blocked"', () => {
  const result = categorizePullRequests([pr({ hasConflicts: true })], ME, neverSnoozed);
  assert.equal(result[0]?.bucket, 'blocked');
});

test('categorizePullRequests: I am a requested reviewer -> "needsReview", even if checks are still pending', () => {
  const result = categorizePullRequests(
    [pr({ authorLogin: 'someone-else', requestedReviewers: [ME], checkStatus: 'pending', reviewDecision: 'reviewRequired' })],
    ME,
    neverSnoozed,
  );
  assert.equal(result[0]?.bucket, 'needsReview');
});

test('categorizePullRequests: needsReview wins over readyToMerge — being asked to review is the more actionable signal', () => {
  // Only one approval is required and someone else already gave it, so the PR-level decision is
  // already "approved" — but I'm still a requested (optional) reviewer.
  const result = categorizePullRequests(
    [pr({ authorLogin: 'someone-else', requestedReviewers: [ME], reviewDecision: 'approved', checkStatus: 'passing' })],
    ME,
    neverSnoozed,
  );
  assert.equal(result[0]?.bucket, 'needsReview');
});

test('categorizePullRequests: my own PR, approved and passing -> "readyToMerge"', () => {
  const result = categorizePullRequests(
    [pr({ authorLogin: ME, reviewDecision: 'approved', checkStatus: 'passing', hasConflicts: false })],
    ME,
    neverSnoozed,
  );
  assert.equal(result[0]?.bucket, 'readyToMerge');
});

test('categorizePullRequests: my own PR, still awaiting review -> "waiting"', () => {
  const result = categorizePullRequests(
    [pr({ authorLogin: ME, reviewDecision: 'reviewRequired', checkStatus: 'pending' })],
    ME,
    neverSnoozed,
  );
  assert.equal(result[0]?.bucket, 'waiting');
});

test('categorizePullRequests: excludes PRs I have no stake in — not authored by me, not requesting my review', () => {
  const result = categorizePullRequests(
    [pr({ authorLogin: 'someone-else', requestedReviewers: ['someone-else-again'] })],
    ME,
    neverSnoozed,
  );
  assert.deepEqual(result, []);
});

test('categorizePullRequests: a completed review (no longer in requestedReviewers) drops the PR once it is not mine and not ready/blocked', () => {
  const result = categorizePullRequests(
    [pr({ authorLogin: 'someone-else', requestedReviewers: [], reviewDecision: 'reviewRequired', checkStatus: 'pending' })],
    ME,
    neverSnoozed,
  );
  assert.deepEqual(result, []);
});
