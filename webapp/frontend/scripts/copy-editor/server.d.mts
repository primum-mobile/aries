import type { Server } from "node:http";

export const COPY_EDITOR_PORT: number;
export function startCopyEditorServer(options?: { port?: number; frontendDir?: string }): Server;
