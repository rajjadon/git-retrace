import type * as vscode from 'vscode';

/**
 * `<viewId>.focus` can return before `resolveWebviewView` has actually fired — observed as a
 * real race on the very first reveal of a freshly-contributed panel container, where the
 * workbench still has to mount the container's UI. Once the container has been shown once,
 * later reveals resolve in time on their own, but nothing guarantees which view runs first.
 */
export async function waitForWebviewView(getView: () => vscode.WebviewView | undefined, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!getView()) {
    if (Date.now() - start > timeoutMs) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
