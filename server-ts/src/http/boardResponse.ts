import type { Board } from '../app/readService.js';
import type { ResourceType } from '../domain/schemas.js';

/**
 * What a live-board screen is sent: only what it draws. No actors, command ids or event internals, because
 * a board may be on a wall where anyone can see it.
 */
export interface BoardResponse {
  readonly workspaceId: string;
  readonly title: string;
  /** Changes whenever the board's content may have changed. */
  readonly version: number;
  readonly generatedAt: string;
  readonly metrics: readonly { readonly label: string; readonly value: number }[];
  readonly resources: readonly {
    readonly id: string;
    readonly type: ResourceType;
    readonly name: string;
    readonly attributes: Readonly<Record<string, unknown>>;
    readonly hasAlert: boolean;
  }[];
  readonly alerts: readonly {
    readonly id: string;
    readonly resourceId: string;
    readonly resourceName: string;
    readonly message: string;
    readonly createdAt: string;
  }[];
  readonly recentActivity: readonly {
    readonly summary: string;
    readonly resourceName: string;
    readonly createdAt: string;
  }[];
}

export function toBoardResponse(board: Board): BoardResponse {
  return {
    workspaceId: board.workspaceId,
    title: board.title,
    version: board.version,
    generatedAt: board.generatedAt.toISOString(),
    metrics: board.metrics.map(({ label, value }) => ({ label, value })),
    resources: board.resources.map(({ resource, hasAlert }) => ({
      id: resource.id,
      type: resource.type,
      name: resource.name,
      attributes: resource.attributes,
      hasAlert,
    })),
    alerts: board.alerts.map((alert) => ({
      id: alert.alertId,
      resourceId: alert.resourceId,
      resourceName: alert.resourceName,
      message: alert.message,
      createdAt: alert.createdAt.toISOString(),
    })),
    recentActivity: board.recentActivity.map((event) => ({
      summary: event.summary,
      resourceName: event.resourceName,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}
