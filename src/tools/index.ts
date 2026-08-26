import { createTodoTool, TodoStore } from '../agent/todo.js';
import { ToolRegistry } from './registry.js';
import { readFileTool } from './readFile.js';
import { listDirectoryTool } from './listDirectory.js';
import { globTool } from './globTool.js';
import { grepTool } from './grepTool.js';
import { writeFileTool } from './writeFile.js';
import { applyPatchTool } from './applyPatch.js';
import { deletePathTool, movePathTool } from './fileOps.js';
import { bashTool } from './bash.js';
import { gitDiffTool, gitLogTool, gitStatusTool } from './git.js';

export * from './types.js';
export * from './registry.js';
export { TodoStore, createTodoTool } from '../agent/todo.js';

/** Register all built-in tools (task/MCP tools are added by the caller). */
export function createBuiltinRegistry(todoStore: TodoStore): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(listDirectoryTool);
  registry.register(globTool);
  registry.register(grepTool);
  registry.register(writeFileTool);
  registry.register(applyPatchTool);
  registry.register(deletePathTool);
  registry.register(movePathTool);
  registry.register(bashTool);
  registry.register(gitStatusTool);
  registry.register(gitDiffTool);
  registry.register(gitLogTool);
  registry.register(createTodoTool(todoStore));
  return registry;
}
