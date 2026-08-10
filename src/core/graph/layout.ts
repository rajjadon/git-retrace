import type { GraphCommit } from '../git/types';

export interface GraphNode {
  commit: GraphCommit;
  /** Column this commit's dot is drawn in. */
  lane: number;
  /** Lanes each of `commit.parents` will occupy at their own row, same order as `commit.parents`. */
  parentLanes: number[];
  /**
   * Lanes that converge into this commit's `lane` at this row — two branches whose lines were
   * independently tracking toward the same ancestor. Render these as diagonal lines folding
   * into `lane`, distinct from `parentLanes` (which fan a merge commit *out* to its parents).
   */
  incomingMergeLanes: number[];
  /**
   * Lane occupancy snapshots (which sha, if any, each lane is tracking) immediately before and
   * after this row. A real git graph draws every unrelated branch as a continuous line through
   * rows it doesn't touch — the renderer derives those pass-through segments by diffing the two:
   * any lane present, unchanged, and not equal to `lane` in both snapshots gets a plain vertical
   * line drawn through this row.
   */
  lanesBefore: Array<string | null>;
  lanesAfter: Array<string | null>;
}

/**
 * Assigns each commit a lane (column) and the connector lines needed to render a commit graph,
 * given commits in topological order (children before parents — see `--topo-order`). Pure — no I/O.
 *
 * The one subtle case this handles deliberately: two lanes can independently be "waiting for"
 * the same not-yet-seen ancestor (e.g. a feature branch and main both descending from the same
 * base commit, with no merge commit tying them together yet). Only a first-parent assignment
 * claims a lane outright; every other-parent assignment first checks whether some other lane
 * already targets that sha and reuses it, and when a commit is finally reached with more than
 * one lane pointing at it, all but one collapse into a single canonical lane.
 */
export function layoutGraph(commits: GraphCommit[]): GraphNode[] {
  const lanes: Array<string | null> = [];
  const nodes: GraphNode[] = [];

  const allocateLane = (): number => {
    const free = lanes.indexOf(null);
    if (free !== -1) {
      return free;
    }
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const commit of commits) {
    const lanesBefore = [...lanes];
    const matchingLanes: number[] = [];
    lanes.forEach((sha, i) => {
      if (sha === commit.sha) {
        matchingLanes.push(i);
      }
    });

    let lane: number;
    let incomingMergeLanes: number[];
    if (matchingLanes.length > 0) {
      [lane] = matchingLanes as [number];
      incomingMergeLanes = matchingLanes.slice(1);
      for (const mergedLane of incomingMergeLanes) {
        lanes[mergedLane] = null;
      }
    } else {
      lane = allocateLane();
      incomingMergeLanes = [];
    }

    const parentLanes: number[] = [];
    const [firstParent, ...otherParents] = commit.parents;

    if (firstParent) {
      lanes[lane] = firstParent;
      parentLanes.push(lane);
    } else {
      lanes[lane] = null;
    }

    for (const parentSha of otherParents) {
      const existingLane = lanes.indexOf(parentSha);
      if (existingLane !== -1) {
        parentLanes.push(existingLane);
        continue;
      }
      const newLane = allocateLane();
      lanes[newLane] = parentSha;
      parentLanes.push(newLane);
    }

    nodes.push({ commit, lane, parentLanes, incomingMergeLanes, lanesBefore, lanesAfter: [...lanes] });
  }

  return nodes;
}
