// SPDX-License-Identifier: Apache-2.0
//
// Compatibility shim. The Chroma (chroma-mcp/uvx subprocess) backend was
// replaced by an in-process vector store (sqlite-vec + transformers.js) in
// `VectorSync`. This module re-exports `VectorSync` under the historical
// `ChromaSync` name (and the `ChromaDocument` type) so the remaining
// type/value importers — DatabaseManager, SearchManager, SearchOrchestrator,
// the search strategies, WorktreeAdoption, worker-service — keep compiling and
// working unchanged. New code should import from `./VectorSync.js` directly.

export { VectorSync, VectorSync as ChromaSync } from './VectorSync.js';
export type { ChromaDocument } from './VectorSync.js';
