import { describe, expect, it } from 'vitest';

import { assignJob } from '../../src/domain/operations/assignJob.js';
import type { Resource } from '../../src/domain/schemas.js';
import { planFor } from '../helpers/plan.js';
import { inventoryItem, makeResource, repairResources } from '../helpers/resources.js';

function find(id: string): Resource {
  const resource = repairResources().find((candidate) => candidate.id === id);
  if (!resource) {
    throw new Error(`fixture has no ${id}`);
  }
  return resource;
}

const names = new Map(repairResources().map((resource) => [resource.id, resource.name]));
const rahul = (): Resource => find('tech_rahul');

describe('assignJob.bind', () => {
  it('targets jobs', () => {
    expect(assignJob.name).toBe('ASSIGN_JOB');
    expect(assignJob.targetTypes).toEqual(['job']);
  });

  it('names a technician as the second resource, and exposes what was said for them', () => {
    const binding = assignJob.bind({ assignee: 'Rahul' });
    expect(binding.ok && binding.bound.secondary).toEqual({ role: 'assignee', types: ['technician'], query: 'Rahul' });
    expect(binding.ok && binding.bound.arguments).toEqual({ assignee: 'Rahul' });
  });

  it.each([{}, { assignee: '' }, { assignee: 7 }])('rejects arguments %j', (args) => {
    expect(assignJob.bind(args).ok).toBe(false);
  });
});

describe('assignJob plan', () => {
  it('assigns a waiting job, moving it to assigned, and always asks for confirmation', () => {
    expect(planFor(assignJob, find('job_108'), { assignee: 'Rahul' }, { secondary: rahul(), names })).toEqual({
      kind: 'ready',
      attributes: { status: 'assigned', assigneeId: 'tech_rahul', description: 'Brake overhaul' },
      before: { assigneeId: null, status: 'waiting' },
      after: { assigneeId: 'tech_rahul', status: 'assigned' },
      summary: 'Assigned Job 108 to Rahul',
      spoken: 'Job 108 is now assigned to Rahul.',
      confirmation: { reason: 'assignment', readback: 'Assign Job 108 to Rahul?' },
    });
  });

  it('reassigns a job that is in progress, keeping its status, and says who had it', () => {
    expect(planFor(assignJob, find('job_109'), { assignee: 'Rahul' }, { secondary: rahul(), names })).toMatchObject({
      kind: 'ready',
      before: { assigneeId: 'tech_priya', status: 'in_progress' },
      after: { assigneeId: 'tech_rahul', status: 'in_progress' },
      summary: 'Reassigned Job 109 from Priya to Rahul',
      confirmation: { readback: 'Reassign Job 109 from Priya to Rahul?' },
    });
  });

  it('falls back to the id when the previous technician is unknown', () => {
    expect(planFor(assignJob, find('job_109'), { assignee: 'Rahul' }, { secondary: rahul() })).toMatchObject({
      summary: 'Reassigned Job 109 from tech_priya to Rahul',
    });
  });

  it('does not create a change when the technician already has the job', () => {
    expect(planFor(assignJob, find('job_109'), { assignee: 'Priya' }, { secondary: find('tech_priya'), names })).toEqual({
      kind: 'rejected',
      code: 'NO_CHANGE',
      message: 'Job 109 is already assigned to Priya.',
    });
  });

  it('refuses a technician who is not on duty', () => {
    expect(planFor(assignJob, find('job_108'), { assignee: 'Vikram' }, { secondary: find('tech_vikram'), names })).toEqual({
      kind: 'rejected',
      code: 'INVALID_ASSIGNEE',
      message: 'Vikram is not an active technician.',
    });
  });

  it('refuses a job that is already done', () => {
    expect(planFor(assignJob, find('job_107'), { assignee: 'Rahul' }, { secondary: rahul(), names })).toEqual({
      kind: 'rejected',
      code: 'JOB_CLOSED',
      message: 'Job 107 is already done and cannot be assigned.',
    });
  });

  it('refuses when no technician was resolved, or the second resource is not a technician', () => {
    const expected = { kind: 'rejected', code: 'INVALID_ASSIGNEE', message: 'No technician was given for this job.' };
    expect(planFor(assignJob, find('job_108'), { assignee: 'x' }, { names })).toEqual(expected);
    expect(
      planFor(assignJob, find('job_108'), { assignee: 'x' }, { secondary: inventoryItem('item_air_filter', 'Air Filter'), names }),
    ).toEqual(expected);
  });

  it('refuses a target that is not a job', () => {
    const technician = makeResource({ id: 'tech_x', type: 'technician', name: 'X', aliases: [], attributes: { active: true } });
    expect(planFor(assignJob, technician, { assignee: 'Rahul' }, { secondary: rahul(), names })).toEqual({
      kind: 'rejected',
      code: 'INVALID_TARGET',
      message: 'X is not a job.',
    });
  });
});
