import type { TemplateDetail, TemplateSummary } from '@datadesk/shared/api';
import type { TemplateInput } from '@datadesk/shared/rules';
import { api } from './api';

export type { TemplateDetail, TemplateSummary };

export const listTemplates = () => api<{ templates: TemplateSummary[] }>('/templates').then((r) => r.templates);
export const getTemplate = (id: string) => api<{ template: TemplateDetail }>(`/templates/${id}`).then((r) => r.template);
export const createTemplate = (input: TemplateInput) =>
  api<{ template: TemplateDetail }>('/templates', { method: 'POST', body: input }).then((r) => r.template);
export const saveTemplate = (id: string, input: TemplateInput) =>
  api<{ template: TemplateDetail }>(`/templates/${id}`, { method: 'PUT', body: input }).then((r) => r.template);
export const setDefaultTemplate = (id: string, isDefault: boolean) =>
  api<{ template: TemplateDetail }>(`/templates/${id}/default`, { method: 'PUT', body: { isDefault } }).then((r) => r.template);
export const deleteTemplate = (id: string) => api<void>(`/templates/${id}`, { method: 'DELETE' });
