export interface TaskEvidence {
  commits?: string[];
  tests?: string[];
  prs?: string[];
}

export interface MessengerActionParams {
  // Action
  action?: string;

  // Spawn stop target
  id?: string;
  taskId?: string;

  // Task creation & lifecycle (legacy — task handlers are preserved but unreachable)
  title?: string;
  content?: string;
  dependsOn?: string[];
  summary?: string;
  evidence?: TaskEvidence;
  cascade?: boolean;

  // Generic text payloads
  prompt?: string;
  message?: string;
  reason?: string;

  // Coordination (legacy — handlers preserved but unreachable)
  to?: string | string[];
  replyTo?: string;
  paths?: string[];
  name?: string;
  channel?: string;
  create?: boolean;
  limit?: number;
  autoRegisterPath?: 'add' | 'remove' | 'list';
  spec?: string;

  // Channels (legacy)
  showAll?: boolean;

  // Spawn
  role?: string;
  persona?: string;
  objective?: string;
  context?: string;
  agentFile?: string;
  messageFile?: string;
  force?: boolean;
}
