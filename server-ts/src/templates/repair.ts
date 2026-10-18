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
  resources: [
    { id: 'tech_rahul', type: 'technician', name: 'Rahul', aliases: [], attributes: { active: true } },
    { id: 'tech_priya', type: 'technician', name: 'Priya', aliases: [], attributes: { active: true } },
    { id: 'tech_arjun', type: 'technician', name: 'Arjun', aliases: [], attributes: { active: true } },
    { id: 'tech_vikram', type: 'technician', name: 'Vikram', aliases: [], attributes: { active: false } },
    {
      id: 'job_107',
      type: 'job',
      name: 'Job 107',
      aliases: [],
      attributes: { status: 'done', assigneeId: 'tech_arjun', description: 'Oil change and service' },
    },
    {
      id: 'job_108',
      type: 'job',
      name: 'Job 108',
      aliases: [],
      attributes: { status: 'waiting', assigneeId: null, description: 'Brake overhaul' },
    },
    {
      id: 'job_109',
      type: 'job',
      name: 'Job 109',
      aliases: [],
      attributes: { status: 'in_progress', assigneeId: 'tech_priya', description: 'AC compressor replacement' },
    },
    {
      id: 'job_110',
      type: 'job',
      name: 'Job 110',
      aliases: [],
      attributes: { status: 'waiting', assigneeId: null, description: 'Clutch plate change' },
    },
  ],
};
