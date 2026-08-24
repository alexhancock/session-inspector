import { StepType } from '../session/session'

export const TYPE_COLOR: Record<StepType, string> = {
  tool: '#f0402c',
  thinking: '#1b7fd0',
  response: '#121212',
  prompt: '#f3b71c',
  idle: '#c3c2b3',
  meta: '#dcdbcd',
}

export const TYPE_NAME: Record<StepType, string> = {
  tool: 'Tool call',
  thinking: 'Thinking',
  response: 'Assistant',
  prompt: 'Prompt',
  idle: 'Waiting',
  meta: 'System',
}

export const TYPE_ORDER: StepType[] = ['prompt', 'thinking', 'response', 'tool', 'idle', 'meta']

export const onDark = (type: StepType): boolean => type === 'response' || type === 'tool' || type === 'thinking'
