import { COMMON_SETTINGS } from './shared.js';
import type { Template } from './types.js';

// Fictional demo data only.
export const repairTemplate: Template = {
  id: 'repair',
  label: 'Repair shop',
  settings: COMMON_SETTINGS,
  workspace: { id: 'eastside-repairs', name: 'Eastside Repair Shop', timezone: 'Asia/Kolkata' },
  board: {
    title: 'Eastside Repair Board',
    metrics: [
      { label: 'Open jobs', kind: 'jobs_open' },
      { label: 'Unassigned', kind: 'jobs_unassigned' },
      { label: 'Technicians on duty', kind: 'technicians_active' },
    ],
  },
  collections: [
    { key: 'technicians', label: 'Technicians', kind: 'technician', aliases: ['staff'] },
    { key: 'jobs', label: 'Jobs', kind: 'job', aliases: [] },
  ],
  resources: [
    { id: 'tech_rahul', collection: 'technicians', type: 'technician', name: 'Rahul', aliases: [], attributes: { active: true } },
    { id: 'tech_priya', collection: 'technicians', type: 'technician', name: 'Priya', aliases: [], attributes: { active: true } },
    { id: 'tech_arjun', collection: 'technicians', type: 'technician', name: 'Arjun', aliases: [], attributes: { active: true } },
    { id: 'tech_vikram', collection: 'technicians', type: 'technician', name: 'Vikram', aliases: [], attributes: { active: false } },
    {
      id: 'job_107',
      collection: 'jobs',
      type: 'job',
      name: 'Job 107',
      aliases: [],
      attributes: { status: 'done', assigneeId: 'tech_arjun', description: 'Oil change and service' },
    },
    {
      id: 'job_108',
      collection: 'jobs',
      type: 'job',
      name: 'Job 108',
      aliases: [],
      attributes: { status: 'waiting', assigneeId: null, description: 'Brake overhaul' },
    },
    {
      id: 'job_109',
      collection: 'jobs',
      type: 'job',
      name: 'Job 109',
      aliases: [],
      attributes: { status: 'in_progress', assigneeId: 'tech_priya', description: 'AC compressor replacement' },
    },
    {
      id: 'job_110',
      collection: 'jobs',
      type: 'job',
      name: 'Job 110',
      aliases: [],
      attributes: { status: 'waiting', assigneeId: null, description: 'Clutch plate change' },
    },
  ],
};
