import type {CodaraCommandResult} from '@capability/command/runtime/types';
import type {CliNotice, CliRunState} from './view-state';

export interface HandleCliCommandHostActionInput {
  result: CodaraCommandResult;
  sessionId: string;
  reopenSession?: (sessionId: string) => Promise<void>;
  openFile?: (targetPath: string) => Promise<boolean>;
  onShowSessionPicker?: () => void;
  appendNotice: (level: CliNotice['level'], content: string) => void;
  setRunState: (state: CliRunState) => void;
}

// 这里专门处理“命令执行完后，需要宿主帮忙收尾”的分支。
// controller 只要问一句：这个 action 你处理完了吗？
export async function handleCliCommandHostAction(input: HandleCliCommandHostActionInput): Promise<boolean> {
  const {
    result,
    sessionId,
    reopenSession,
    openFile,
    onShowSessionPicker,
    appendNotice,
    setRunState,
  } = input;
  const action = result.action;
  if (!action) {
    return false;
  }

  if (action.type === 'show_session_picker') {
    if (onShowSessionPicker) {
      onShowSessionPicker();
    } else {
      appendNotice('error', 'Session picker is not available in this CLI runtime.');
    }
    setRunState({status: 'done'});
    return true;
  }

  if (action.type === 'resume_session') {
    appendNotice(result.ok ? 'system' : 'error', result.output || '(no output)');
    if (!result.ok) {
      setRunState({status: 'error', error: result.output});
      return true;
    }
    if (sessionId === action.sessionId) {
      setRunState({status: 'done'});
      return true;
    }
    if (!reopenSession) {
      setRunState({status: 'error', error: 'Session resume handler is not available in this CLI runtime.'});
      appendNotice('error', 'Session resume handler is not available in this CLI runtime.');
      return true;
    }
    await reopenSession(action.sessionId);
    return true;
  }

  if (action.type === 'open_file') {
    const opened = openFile ? await openFile(action.path) : false;
    appendNotice(opened ? 'system' : 'warning', opened
      ? `Opened ${action.path}`
      : `Open file: ${action.path}`);
    setRunState(result.ok ? {status: 'done'} : {status: 'error', error: result.output});
    return true;
  }

  if (action.type === 'enter_team') {
    appendNotice(result.ok ? 'system' : 'error', result.output || (result.ok ? `Entered team ${action.teamId}` : '(no output)'));
    setRunState(result.ok ? {status: 'done'} : {status: 'error', error: result.output});
    return true;
  }

  if (action.type === 'leave_team') {
    appendNotice('system', result.output || 'Left team view.');
    setRunState({status: 'done'});
    return true;
  }

  return false;
}
