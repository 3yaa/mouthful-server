// function linkRelations(graph) {
// 	const adj = new Map();
// 	// set map
// 	for (const node of graph.nodes) {
// 		adj.set(node.id, []);
// 	}
// 	// bidirectional fill
// 	for (const link of graph.links) {
// 		const relation = link.relation;
// 		// push relation to source node
// 		adj.get(link.source_id)?.push({
// 			id: link.target_id,
// 			relation,
// 		});
// 		// push relation to target node
// 		adj.get(link.target_id)?.push({
// 			id: link.source_id,
// 			relation,
// 		});
// 	}

// 	return adj;
// }

// export function getRelationMap(graph, rootMalId) {
// 	const SPINE_RELATIONS = new Set(["prequel", "sequel"]);
// 	const spine = new Set([rootMalId]);
// 	const additionals = new Set();
// 	const queue = [rootMalId];
// 	//
// 	const linkedRelations = linkRelations(graph);

// 	// build mainline first
// 	while (queue.length > 0) {
// 		const current = queue.shift();

// 		for (const edge of linkedRelations.get(current) ?? []) {
// 			if (!SPINE_RELATIONS.has(edge.relation) || spine.has(edge.id))
// 				continue;
// 			//
// 			spine.add(edge.id);
// 			queue.push(edge.id);
// 		}
// 	}

// 	// every other relation
// 	for (const node of graph.nodes) {
// 		if (!spine.has(node.id)) additionals.add(node.id);
// 	}

// 	return {
// 		spine,
// 		additionals,
// 	};
// }
