import { z } from 'zod';
import { ok, type ToolDefinition } from '../tools/types.js';

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'done';
}

/** Shared per-session todo list shown in the UI and to the model. */
export class TodoStore {
  private items: TodoItem[] = [];
  private listeners = new Set<(items: TodoItem[]) => void>();

  set(items: TodoItem[]): void {
    this.items = items;
    for (const l of this.listeners) l(this.items);
  }

  get(): TodoItem[] {
    return this.items;
  }

  onChange(listener: (items: TodoItem[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  renderForModel(): string {
    if (this.items.length === 0) return '(task list is empty)';
    return this.items
      .map((t) => {
        const mark = t.status === 'done' ? '[x]' : t.status === 'in_progress' ? '[>]' : '[ ]';
        return `${mark} ${t.content}`;
      })
      .join('\n');
  }
}

const schema = z.object({
  todos: z
    .array(
      z.object({
        content: z.string().min(1),
        status: z.enum(['pending', 'in_progress', 'done']),
      }),
    )
    .min(0)
    .max(30)
    .describe('The complete task list, replacing the previous one.'),
});
type Args = z.infer<typeof schema>;

export function createTodoTool(store: TodoStore): ToolDefinition<Args> {
  return {
    name: 'todo_write',
    description:
      'Track multi-step work as a task list. Replaces the whole list. ' +
      'Use it for tasks with 3+ steps: mark one item in_progress, complete ' +
      'items as you finish them, and keep the list honest.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'done'] },
            },
            required: ['content', 'status'],
          },
        },
      },
      required: ['todos'],
    },
    schema,
    kind: 'read',
    mutating: false,
    summarize: (a) => `${a.todos.length} task${a.todos.length === 1 ? '' : 's'}`,
    async execute(args) {
      store.set(args.todos);
      return ok(store.renderForModel(), { kind: 'todo', title: 'Tasks' });
    },
  };
}
