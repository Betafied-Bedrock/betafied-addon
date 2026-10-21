// QuickJS: Minecraft provides only `console`; no browser or Node.js globals exist.

declare interface Console {
  log(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
  info(...data: unknown[]): void;
}

declare const console: Console;
