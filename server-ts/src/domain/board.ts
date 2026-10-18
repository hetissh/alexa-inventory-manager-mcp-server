import type { Resource } from './schemas.js';
import type { AlertRecord } from './types.js';

export const METRIC_KINDS = [
  'low_stock',
  'equipment_unavailable',
  'menu_available',
  'menu_sold_out',
  'jobs_open',
  'jobs_unassigned',
  'technicians_active',
] as const;
export type MetricKind = (typeof METRIC_KINDS)[number];

/** One headline number on a board, chosen by the workspace template. */
export interface MetricDefinition {
  readonly label: string;
  readonly kind: MetricKind;
}

export interface BoardMetric {
  readonly label: string;
  readonly value: number;
}

type Measure = (resources: readonly Resource[], openAlerts: readonly AlertRecord[]) => number;

function countWhere(resources: readonly Resource[], test: (resource: Resource) => boolean): number {
  return resources.filter(test).length;
}

const MEASURES: Readonly<Record<MetricKind, Measure>> = {
  // ALERT_RULES has one member today, so the types see the comparison as always true; it matters once there are more.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  low_stock: (_resources, openAlerts) => openAlerts.filter((alert) => alert.rule === 'low_stock').length,
  equipment_unavailable: (resources) =>
    countWhere(resources, (r) => r.type === 'equipment' && r.attributes.status !== 'available'),
  menu_available: (resources) =>
    countWhere(resources, (r) => r.type === 'menu_item' && r.attributes.status === 'available'),
  menu_sold_out: (resources) =>
    countWhere(resources, (r) => r.type === 'menu_item' && r.attributes.status === 'sold_out'),
  jobs_open: (resources) => countWhere(resources, (r) => r.type === 'job' && r.attributes.status !== 'done'),
  jobs_unassigned: (resources) =>
    countWhere(resources, (r) => r.type === 'job' && r.attributes.status !== 'done' && r.attributes.assigneeId === null),
  technicians_active: (resources) => countWhere(resources, (r) => r.type === 'technician' && r.attributes.active),
};

export function computeMetrics(
  definitions: readonly MetricDefinition[],
  resources: readonly Resource[],
  openAlerts: readonly AlertRecord[],
): BoardMetric[] {
  return definitions.map(({ label, kind }) => ({ label, value: MEASURES[kind](resources, openAlerts) }));
}
