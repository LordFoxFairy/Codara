// src/cli/components/permission/DetailedView.tsx

import React from 'react';
import { Box, Text } from 'ink';
import type { PermissionViewProps, BashAnalysisResult } from './types';

interface DetailedViewProps extends PermissionViewProps {
  bashAnalysis?: BashAnalysisResult;
  onBack: () => void;
}

export const DetailedView: React.FC<DetailedViewProps> = ({
  toolCall,
  evaluation,
  bashAnalysis,
  onAction,
  onBack
}) => {
  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'low': return 'green';
      case 'medium': return 'yellow';
      case 'high': return 'red';
      case 'critical': return 'magenta';
      default: return 'white';
    }
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="yellow">Permission Details</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text dimColor>Tool:</Text>
        <Text>  {toolCall.tool}</Text>
        <Text dimColor>Input:</Text>
        <Text>  {toolCall.input}</Text>
      </Box>

      {bashAnalysis && (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>Risk Level:</Text>
          <Text>  <Text color={getRiskColor(bashAnalysis.risk)}>{bashAnalysis.risk}</Text></Text>
          {bashAnalysis.operations.length > 0 && (
            <>
              <Text dimColor>Operations:</Text>
              {bashAnalysis.operations.map((op, i) => (
                <Text key={i}>  - {op}</Text>
              ))}
            </>
          )}
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        <Text dimColor>Decision:</Text>
        <Text>  {evaluation.decision}</Text>
        {evaluation.matched && (
          <>
            <Text dimColor>Matched Rule:</Text>
            <Text>  {evaluation.matched.rule}</Text>
          </>
        )}
      </Box>

      <Box flexDirection="column">
        <Box>
          <Text color="green">[y]</Text>
          <Text> Yes</Text>
        </Box>
        <Box>
          <Text color="blue">[a]</Text>
          <Text> Yes, don't ask again</Text>
        </Box>
        <Box>
          <Text color="red">[n]</Text>
          <Text> No</Text>
        </Box>
        <Box>
          <Text dimColor>[b]</Text>
          <Text dimColor> Back</Text>
        </Box>
      </Box>
    </Box>
  );
};
