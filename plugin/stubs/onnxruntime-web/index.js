// Deliberately empty stub — see the onnxruntime-web override in
// scripts/build-hooks.js. The worker uses onnxruntime-node; the node build of
// @huggingface/transformers never imports this package.
//
// Throw rather than export an empty object: if a future transformers release
// does reach for the web backend under Node, that must fail loudly here instead
// of degrading into a confusing runtime error deep inside inference.
throw new Error(
  'onnxruntime-web is stubbed out in keepmind: the worker runs the onnxruntime-node backend. ' +
  'If you are seeing this, @huggingface/transformers now loads the web backend under Node and ' +
  'the override in scripts/build-hooks.js must be removed.'
);
