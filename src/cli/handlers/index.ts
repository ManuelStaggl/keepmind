
import type { EventHandler } from '../types.js';
import { HOOK_EXIT_CODES } from '../../shared/hook-constants.js';
import { logger } from '../../utils/logger.js';
import { contextHandler } from './context.js';
import { sessionInitHandler } from './session-init.js';
import { observationHandler } from './observation.js';
import { summarizeHandler } from './summarize.js';
import { userMessageHandler } from './user-message.js';
import { fileEditHandler } from './file-edit.js';
import { fileContextHandler } from './file-context.js';
import { sessionAcquireHandler } from './session-acquire.js';
import { sessionReleaseHandler } from './session-release.js';
import { sessionStartHandler } from './session-start.js';
import { precompactHandler } from './precompact.js';
import { decisionCheckHandler } from './decision-check.js';

export type EventType =
  | 'context'
  | 'session-start'
  | 'session-init'
  | 'observation'
  | 'summarize'
  | 'user-message'
  | 'file-edit'
  | 'file-context'
  | 'session-acquire'
  | 'session-release'
  | 'precompact'
  | 'decision-check';

const handlers: Record<EventType, EventHandler> = {
  'context': contextHandler,
  // Bundles session-acquire + context into one hook (perf plan P3). The two
  // sub-events stay registered above/below for other hosts and older configs.
  'session-start': sessionStartHandler,
  'session-init': sessionInitHandler,
  'observation': observationHandler,
  'summarize': summarizeHandler,
  'user-message': userMessageHandler,
  'file-edit': fileEditHandler,
  'file-context': fileContextHandler,
  'session-acquire': sessionAcquireHandler,
  'session-release': sessionReleaseHandler,
  'precompact': precompactHandler,
  'decision-check': decisionCheckHandler
};

export function getEventHandler(eventType: string): EventHandler {
  const handler = handlers[eventType as EventType];
  if (!handler) {
    logger.warn('HOOK', `Unknown event type: ${eventType}, returning no-op`);
    return {
      async execute() {
        return { continue: true, suppressOutput: true, exitCode: HOOK_EXIT_CODES.SUCCESS };
      }
    };
  }
  return handler;
}

export { contextHandler } from './context.js';
export { sessionInitHandler } from './session-init.js';
export { observationHandler } from './observation.js';
export { summarizeHandler } from './summarize.js';
export { userMessageHandler } from './user-message.js';
export { fileEditHandler } from './file-edit.js';
export { fileContextHandler } from './file-context.js';
export { sessionAcquireHandler } from './session-acquire.js';
export { sessionReleaseHandler } from './session-release.js';
export { sessionStartHandler } from './session-start.js';
export { precompactHandler } from './precompact.js';
