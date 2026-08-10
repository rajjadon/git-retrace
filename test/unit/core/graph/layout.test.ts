import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutGraph } from '../../../../src/core/graph/layout';
import type { GraphCommit } from '../../../../src/core/git/types';

function commit(sha: string, parents: string[]): GraphCommit {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    author: 'Raj Jadon',
    authorEmail: 'raj@example.com',
    date: '2024-01-01T10:00:00Z',
    message: sha,
    parents,
    refs: [],
  };
}

test('layoutGraph: linear history stays in a single lane', () => {
  const commits = [commit('C', ['B']), commit('B', ['A']), commit('A', [])];
  const nodes = layoutGraph(commits);
  assert.deepEqual(
    nodes.map((n) => n.lane),
    [0, 0, 0],
  );
  assert.deepEqual(
    nodes.map((n) => n.parentLanes),
    [[0], [0], []],
  );
  assert.deepEqual(
    nodes.map((n) => n.incomingMergeLanes),
    [[], [], []],
  );
});

test('layoutGraph: a root commit frees its lane (no parentLanes)', () => {
  const [node] = layoutGraph([commit('A', [])]);
  assert.equal(node?.lane, 0);
  assert.deepEqual(node?.parentLanes, []);
});

test('layoutGraph: a merge commit fans out to two lanes for its two parents', () => {
  const commits = [commit('Merge', ['A', 'B']), commit('B', []), commit('A', [])];
  const nodes = layoutGraph(commits);
  const merge = nodes[0];
  assert.equal(merge?.lane, 0);
  assert.deepEqual(merge?.parentLanes, [0, 1]); // first parent A stays in lane 0, second parent B gets a new lane 1
});

test('layoutGraph: two branches sharing a base commit converge into one lane (the diamond case)', () => {
  // Merge -> M2 -> M1 \
  //       \ F1 --------> Base
  const commits = [
    commit('Merge', ['M2', 'F1']),
    commit('M2', ['M1']),
    commit('F1', ['Base']),
    commit('M1', ['Base']),
    commit('Base', []),
  ];
  const nodes = layoutGraph(commits);
  const [merge, m2, f1, m1, base] = nodes;

  assert.equal(merge?.lane, 0);
  assert.deepEqual(merge?.parentLanes, [0, 1]);

  assert.equal(m2?.lane, 0);
  assert.deepEqual(m2?.parentLanes, [0]);

  assert.equal(f1?.lane, 1);
  assert.deepEqual(f1?.parentLanes, [1]);

  assert.equal(m1?.lane, 0);
  assert.deepEqual(m1?.parentLanes, [0]);

  // Base is the shared ancestor: both lane 0 (via M1) and lane 1 (via F1) point to it.
  // It must render in exactly one lane, with the other lane recorded as a converging merge.
  assert.equal(base?.lane, 0);
  assert.deepEqual(base?.parentLanes, []);
  assert.deepEqual(base?.incomingMergeLanes, [1]);
});

test('layoutGraph: a freed lane (from a converged/root commit) is reused by a later independent branch', () => {
  const commits = [
    commit('Root2', ['Base']), // new, independent branch tip, processed after Base frees a lane
    commit('Base', []),
  ];
  const nodes = layoutGraph(commits);
  // Root2 isn't connected to anything yet when processed — gets lane 0 (first free slot).
  assert.equal(nodes[0]?.lane, 0);
  assert.equal(nodes[1]?.lane, 0);
});

test('layoutGraph: independent lanes both reserving the same not-yet-seen parent share one lane before it is reached', () => {
  // A and B are siblings (processed before their shared second parent Z is reached);
  // both list Z as a *second* parent, so the reservation logic (not the collapse logic) applies.
  const commits = [
    commit('A', ['P1', 'Z']),
    commit('B', ['P2', 'Z']),
    commit('P1', []),
    commit('P2', []),
    commit('Z', []),
  ];
  const nodes = layoutGraph(commits);
  const [a, b] = nodes;
  const zLaneFromA = a?.parentLanes[1];
  const zLaneFromB = b?.parentLanes[1];
  assert.equal(zLaneFromA, zLaneFromB);
});

test('layoutGraph: empty input produces no nodes', () => {
  assert.deepEqual(layoutGraph([]), []);
});

test('layoutGraph: lanesBefore/lanesAfter let the renderer derive a pass-through line for a middle row', () => {
  // While a merge commit's second parent (F1) is pending, an unrelated commit U is processed
  // in between — U's own row must show lane 1 (F1's lane) as an untouched pass-through.
  const commits = [commit('Merge', ['U', 'F1']), commit('U', ['Base']), commit('F1', ['Base']), commit('Base', [])];
  const nodes = layoutGraph(commits);
  const uRow = nodes[1];
  assert.ok(uRow);
  assert.equal(uRow.lane, 0); // U inherits the canonical lane (first parent of Merge)
  // Lane 1 (F1) is present, unchanged, before and after U's row, and isn't U's own lane.
  const passThroughLanes = uRow.lanesBefore
    .map((sha, i) => (sha !== null && sha === uRow.lanesAfter[i] && i !== uRow.lane ? i : -1))
    .filter((i) => i !== -1);
  assert.deepEqual(passThroughLanes, [1]);
});

test('layoutGraph: matches this repo\'s real merge history shape (two merge commits, no crash, sane lanes)', () => {
  const commits = [
    commit('tip', ['fix']),
    commit('fix', ['merge2']),
    commit('merge2', ['pr2side', 'merge1']),
    commit('pr2side', ['milestone1']),
    commit('merge1', ['reorg', 'milestone1']),
    commit('milestone1', ['reorg']),
    commit('reorg', ['first']),
    commit('first', []),
  ];
  const nodes = layoutGraph(commits);
  assert.equal(nodes.length, commits.length);
  for (const node of nodes) {
    assert.ok(node.lane >= 0);
    for (const l of node.parentLanes) assert.ok(l >= 0);
  }
});
