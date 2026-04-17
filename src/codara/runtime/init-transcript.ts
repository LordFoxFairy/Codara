/** JSONL transcript wiring: event subscription + dispose chain. */
import {randomUUID} from 'node:crypto';
import {TranscriptWriter} from '@state/session/transcript';
import {getTranscriptPath} from '@state/session/storage';
import type {SettingsWatcher} from '@config/watcher';
import type {Codara} from '../types';

/** Subscribe to runtime events and persist model/tool/turn entries as JSONL transcript. */
export function wireTranscript(
  runtime: Codara,
  projectRoot: string,
  userHome: string,
): TranscriptWriter {
  const transcriptPath = getTranscriptPath({
    projectRoot,
    userHome,
    sessionId: runtime.getState().sessionId,
  });
  const transcriptWriter = new TranscriptWriter({filePath: transcriptPath});

  runtime.subscribeRuntimeEvents((event) => {
    if (event.kind === 'model' && event.phase === 'end') {
      transcriptWriter.append({
        type: 'assistant',
        uuid: event.id ?? randomUUID(),
        timestamp: Date.now(),
        content: event.label ?? '',
        metadata: {model: event.detail},
      });
    }
    if (event.kind === 'tool' && event.phase === 'end') {
      transcriptWriter.append({
        type: 'tool_result',
        uuid: event.id ?? randomUUID(),
        timestamp: Date.now(),
        content: event.detail ?? '',
        metadata: {toolName: event.label},
      });
    }
    if (event.kind === 'turn' && event.phase === 'start') {
      transcriptWriter.append({
        type: 'user',
        uuid: event.id ?? randomUUID(),
        timestamp: Date.now(),
        content: event.label ?? '',
      });
    }
  });

  return transcriptWriter;
}

/** Augment the original dispose with transcript flush and settings watcher stop. */
export function wrapDispose(
  originalDispose: () => Promise<void>,
  transcriptWriter: TranscriptWriter,
  settingsWatcher: SettingsWatcher,
): () => Promise<void> {
  return async () => {
    await transcriptWriter.close();
    await settingsWatcher.stop();
    await originalDispose();
  };
}
