import type * as vscode from 'vscode';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

export function context(): vscode.ExtensionContext {
  const values = new Map<string, unknown>();
  return {
    globalState: {
      get: (key: string, fallback?: unknown) => values.get(key) ?? fallback,
      update: async (key: string, value: unknown) => {
        values.set(key, value);
      },
    },
  } as unknown as vscode.ExtensionContext;
}
