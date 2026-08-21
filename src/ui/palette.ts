import { StepKind } from '../session'

export const KIND_COLOR: Record<StepKind, string> = {
  tool: '#f0402c',
  thinking: '#1b7fd0',
  response: '#121212',
  prompt: '#f3b71c',
  idle: '#c3c2b3',
  meta: '#dcdbcd',
}

export const KIND_NAME: Record<StepKind, string> = {
  tool: 'Tool call',
  thinking: 'Thinking',
  response: 'Assistant',
  prompt: 'Prompt',
  idle: 'Waiting',
  meta: 'System',
}

export const KIND_ORDER: StepKind[] = ['prompt', 'thinking', 'response', 'tool', 'idle', 'meta']

export const onDark = (kind: StepKind): boolean => kind === 'response' || kind === 'tool' || kind === 'thinking'
