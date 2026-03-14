// src/cli/components/permission/PermissionPanel.tsx

import React, { useState } from 'react';
import { Box } from 'ink';
import { QuickView } from './QuickView';
import { DetailedView } from './DetailedView';
import { EditView } from './EditView';
import type { PermissionViewProps, BashAnalysisResult } from './types';

type ViewMode = 'quick' | 'detailed' | 'edit';

interface PermissionPanelProps extends PermissionViewProps {
  bashAnalysis?: BashAnalysisResult;
}

export const PermissionPanel: React.FC<PermissionPanelProps> = ({
  toolCall,
  evaluation,
  bashAnalysis,
  onAction
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('quick');
  const [editedInput, setEditedInput] = useState(toolCall.input);

  const handleAction = (actionId: string) => {
    if (actionId === 'd') {
      setViewMode('detailed');
    } else if (actionId === 'e') {
      setViewMode('edit');
    } else if (actionId === 'b') {
      setViewMode('quick');
    } else {
      onAction(actionId);
    }
  };

  return (
    <Box>
      {viewMode === 'quick' && (
        <QuickView
          toolCall={toolCall}
          evaluation={evaluation}
          onAction={handleAction}
        />
      )}
      {viewMode === 'detailed' && (
        <DetailedView
          toolCall={toolCall}
          evaluation={evaluation}
          bashAnalysis={bashAnalysis}
          onAction={handleAction}
          onBack={() => setViewMode('quick')}
        />
      )}
      {viewMode === 'edit' && (
        <EditView
          toolCall={toolCall}
          evaluation={evaluation}
          editedInput={editedInput}
          onInputChange={setEditedInput}
          onAction={handleAction}
          onBack={() => setViewMode('quick')}
        />
      )}
    </Box>
  );
};
