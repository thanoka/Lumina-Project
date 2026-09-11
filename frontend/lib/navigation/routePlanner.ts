import { LocationNode, Neighbor, NavStep, Route, TurnRef } from './types';

const DIRECTION_TH: Record<string, string> = {
  'forward':  'ตรงไปข้างหน้า',
  'backward': 'กลับหลังหัน',
  'left':     'เลี้ยวซ้าย',
  'right':    'เลี้ยวขวา',
  'up':       'ขึ้นข้างบน',
  'down':     'ลงข้างล่าง',
};

const PATH_TYPE_TH: Record<string, string> = {
  'open_foyer': 'ผ่านห้องโถง',
  'open_hall':  'ผ่านทางเดินกว้าง',
  'corridor':   'ผ่านทางเดิน',
  'stairway':   'ขึ้นบันได',
  'elevator':   'ใช้ลิฟต์',
};

function buildAdjacency(nodes: LocationNode[]): Map<string, LocationNode> {
  const map = new Map<string, LocationNode>();
  for (const node of nodes) {
    map.set(node.id, node);
  }
  return map;
}

function findEdge(node: LocationNode, toId: string): Neighbor | undefined {
  return node.neighbors.find(n => n.target_id === toId);
}

function bfsPath(
  adjacency: Map<string, LocationNode>,
  sourceId: string,
  destId: string
): string[] {
  if (sourceId === destId) return [sourceId];

  const visited = new Set<string>();
  const parent = new Map<string, string>();
  const queue: string[] = [sourceId];
  visited.add(sourceId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = adjacency.get(current);
    if (!node) continue;

    for (const neighbor of node.neighbors) {
      if (visited.has(neighbor.target_id)) continue;
      visited.add(neighbor.target_id);
      parent.set(neighbor.target_id, current);

      if (neighbor.target_id === destId) {
        const path: string[] = [];
        let curr: string | undefined = destId;
        while (curr !== undefined) {
          path.unshift(curr);
          curr = parent.get(curr);
        }
        return path;
      }

      queue.push(neighbor.target_id);
    }
  }

  return [];
}

function generateInstruction(
  direction: string,
  distance: string,
  destName: string,
  pathType: string,
  stepIndex: number,
  totalSteps: number,
  turnRef?: TurnRef
): string {
  const dirTH  = DIRECTION_TH[direction] || direction;
  const pathTH = PATH_TYPE_TH[pathType]  || '';

  // For turns: walk forward first, then turn when you see the landmark
  if (turnRef && (direction === 'left' || direction === 'right')) {
    const refName = turnRef.text_content || turnRef.object_name;
    const prefix  = stepIndex === 0 ? 'เริ่มต้น' : 'จากนั้น';
    return `${prefix} เดินตรงไปข้างหน้า ${pathTH} เมื่อเห็น "${refName}" ให้${dirTH} ประมาณ ${distance}`;
  }

  if (totalSteps === 1) {
    return `${dirTH} ${pathTH} ประมาณ ${distance} จะถึง ${destName}`;
  }

  if (stepIndex === 0) {
    return `เริ่มต้น ${dirTH} ${pathTH} ประมาณ ${distance}`;
  }

  if (stepIndex === totalSteps - 1) {
    return `จากนั้น ${dirTH} ${pathTH} ประมาณ ${distance} จะถึง ${destName}`;
  }

  return `จากนั้น ${dirTH} ${pathTH} ประมาณ ${distance}`;
}

export function planRoute(
  mapNodes: LocationNode[],
  sourceId: string,
  destId: string
): Route | null {
  const adjacency = buildAdjacency(mapNodes);

  if (!adjacency.has(sourceId) || !adjacency.has(destId)) return null;

  if (sourceId === destId) {
    const node = adjacency.get(sourceId)!;
    return { steps: [], totalSteps: 0, destinationName: node.name };
  }

  const path = bfsPath(adjacency, sourceId, destId);
  if (path.length < 2) return null;

  const steps: NavStep[] = [];
  const totalSegments = path.length - 1;

  for (let i = 0; i < totalSegments; i++) {
    const fromId   = path[i];
    const toId     = path[i + 1];
    const fromNode = adjacency.get(fromId)!;
    const toNode   = adjacency.get(toId)!;
    const edge     = findEdge(fromNode, toId);

    if (!edge) continue;

    const instruction = generateInstruction(
      edge.direction,
      edge.distance_approx,
      toNode.name,
      edge.path_type,
      i,
      totalSegments,
      edge.turn_ref
    );

    steps.push({
      from:            fromId,
      to:              toId,
      direction:       edge.direction,
      distance:        edge.distance_approx,
      pathType:        edge.path_type,
      destinationName: toNode.name,
      instruction,
      turn_ref:        edge.turn_ref,
    });
  }

  const destNode = adjacency.get(destId)!;
  return { steps, totalSteps: steps.length, destinationName: destNode.name };
}

export function getDestinations(mapNodes: LocationNode[]): { id: string; name: string }[] {
  return mapNodes.map(n => ({ id: n.id, name: n.name }));
}

export function getNodeById(
  mapNodes: LocationNode[],
  nodeId: string
): LocationNode | undefined {
  return mapNodes.find(n => n.id === nodeId);
}
