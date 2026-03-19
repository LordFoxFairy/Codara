export type CliDraftSubmissionPlan =
  | {
      type: 'empty';
    }
  | {
      type: 'plain-prompt';
      prompt: string;
    }
  | {
      type: 'team-message';
      teamName: string;
      message: string;
      command: string;
    }
  | {
      type: 'team-not-found';
      teamName: string;
      availableTeams: string[];
    };

export interface ResolveCliDraftSubmissionInput {
  text: string;
  teamNames: readonly string[];
}

// 这里先把 draft 文本翻译成“接下来要做什么”。
// controller 只负责执行，不再顺手处理一堆字符串分支。
export function resolveCliDraftSubmission(input: ResolveCliDraftSubmissionInput): CliDraftSubmissionPlan {
  const prompt = input.text.trim();
  if (!prompt) {
    return {type: 'empty'};
  }

  const teamMentionMatch = prompt.match(/^@(\S+)\s+([\s\S]*)/);
  if (!teamMentionMatch) {
    return {
      type: 'plain-prompt',
      prompt,
    };
  }

  const teamName = teamMentionMatch[1]!;
  const message = teamMentionMatch[2]!;
  if (input.teamNames.includes(teamName)) {
    return {
      type: 'team-message',
      teamName,
      message,
      command: `/team message ${teamName} ${message}`,
    };
  }

  return {
    type: 'team-not-found',
    teamName,
    availableTeams: [...input.teamNames],
  };
}
