/** A command ID was already used by a different request in this workspace. */
export class DuplicateCommandError extends Error {
  constructor(
    readonly workspaceId: string,
    readonly commandId: string,
  ) {
    super(`Command "${commandId}" was already used in workspace "${workspaceId}".`);
    this.name = 'DuplicateCommandError';
  }
}

/** The resource changed between being read and being written. */
export class VersionConflictError extends Error {
  constructor(
    readonly resourceId: string,
    readonly expectedVersion: number,
  ) {
    super(`Resource "${resourceId}" is no longer at version ${String(expectedVersion)}.`);
    this.name = 'VersionConflictError';
  }
}

export class WorkspaceNotFoundError extends Error {
  constructor(readonly workspaceId: string) {
    super(`Workspace "${workspaceId}" was not found.`);
    this.name = 'WorkspaceNotFoundError';
  }
}
