/** The API client modules: request shapes, error mapping and session handling. */
import { describe, expect, it } from 'vitest';
import { apiError, mockApi } from '../test/mockApi';
import { api, ApiError } from './api';
import { fetchSession, signIn, signOut, signUp } from './auth';
import { createTemplate, deleteTemplate, getTemplate, listTemplates, saveTemplate, setDefaultTemplate } from './templates';
import { createUpload, downloads, getUpload, listIssues, listRows, listUploads, removeUpload } from './uploads';

describe('api()', () => {
  it('sends JSON and returns the parsed body', async () => {
    const m = mockApi({ 'POST /api/things': (c) => ({ body: { echo: c.body } }) });
    expect(await api('/things', { method: 'POST', body: { a: 1 } })).toEqual({ echo: { a: 1 } });
    const init = m.fetchMock.mock.calls[0][1]!;
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.credentials).toBe('same-origin');
  });

  it('returns undefined for 204', async () => {
    mockApi({ 'DELETE /api/x': { status: 204 } });
    expect(await api('/x', { method: 'DELETE' })).toBeUndefined();
  });

  it('turns the error format into an ApiError with status, code and field messages', async () => {
    mockApi({ 'POST /api/x': apiError(400, 'validation_failed', 'Bad', { name: 'Required.' }) });
    const err = await api('/x', { method: 'POST', body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: 'validation_failed', message: 'Bad', fields: { name: 'Required.' } });
  });

  it('copes with a non-JSON error body and with the network being down', async () => {
    mockApi({});
    (globalThis.fetch as unknown as { mockResolvedValueOnce: (r: Response) => void }).mockResolvedValueOnce(new Response('<html>502</html>', { status: 502 }));
    expect(await api('/x').catch((e) => e)).toMatchObject({ status: 502, code: 'http_error', message: 'Request failed (502).' });
    (globalThis.fetch as unknown as { mockRejectedValueOnce: (e: Error) => void }).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await api('/x').catch((e) => e)).toMatchObject({ status: 0, code: 'network_error' });
  });

  it('sends FormData as multipart (no JSON content type)', async () => {
    const m = mockApi({ 'POST /api/up': { body: {} } });
    const form = new FormData();
    await api('/up', { method: 'POST', body: form });
    expect(m.fetchMock.mock.calls[0][1]!.headers).toBeUndefined();
    expect(m.calls[0].form).toBe(form);
  });
});

describe('auth client', () => {
  const user = { id: 'u1', name: 'Priya', email: 'p@x.co' };
  it('maps the API user to a session, for sign-in, sign-up and "me"', async () => {
    const m = mockApi({ 'POST /api/auth/login': { body: { user } }, 'POST /api/auth/signup': { status: 201, body: { user } }, 'GET /api/auth/me': { body: { user } }, 'POST /api/auth/logout': { status: 204 } });
    const s = { userId: 'u1', name: 'Priya', email: 'p@x.co' };
    expect(await signIn('p@x.co', 'pw')).toEqual(s);
    expect(await signUp('Priya', 'p@x.co', 'pw')).toEqual(s);
    expect(await fetchSession()).toEqual(s);
    await signOut();
    expect(m.to('POST /api/auth/login')[0].body).toEqual({ email: 'p@x.co', password: 'pw' });
    expect(m.to('POST /api/auth/signup')[0].body).toEqual({ name: 'Priya', email: 'p@x.co', password: 'pw' });
    expect(m.to('POST /api/auth/logout')).toHaveLength(1);
  });
  it('fetchSession: null when signed out, but other failures are real errors', async () => {
    mockApi({ 'GET /api/auth/me': apiError(401, 'unauthenticated', 'Please sign in.') });
    expect(await fetchSession()).toBeNull();
    mockApi({ 'GET /api/auth/me': apiError(500, 'internal_error', 'Boom') });
    await expect(fetchSession()).rejects.toMatchObject({ status: 500 });
  });
});

describe('templates client', () => {
  it('calls the right endpoints with the right bodies', async () => {
    const t = { id: 't1' };
    const m = mockApi({
      'GET /api/templates': { body: { templates: [t] } },
      'GET /api/templates/:id': { body: { template: t } },
      'POST /api/templates': { status: 201, body: { template: t } },
      'PUT /api/templates/:id': { body: { template: t } },
      'PUT /api/templates/:id/default': { body: { template: t } },
      'DELETE /api/templates/:id': { status: 204 },
    });
    expect(await listTemplates()).toEqual([t]);
    expect(await getTemplate('t1')).toEqual(t);
    await createTemplate({ name: 'A' } as never);
    await saveTemplate('t1', { name: 'B' } as never);
    await setDefaultTemplate('t1', true);
    await deleteTemplate('t1');
    expect(m.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /api/templates', 'GET /api/templates/t1', 'POST /api/templates', 'PUT /api/templates/t1', 'PUT /api/templates/t1/default', 'DELETE /api/templates/t1',
    ]);
    expect(m.to('PUT /api/templates/t1/default')[0].body).toEqual({ isDefault: true });
  });
});

describe('uploads client', () => {
  it('builds query strings, skipping empty filters', async () => {
    const m = mockApi({
      'GET /api/uploads': { body: { uploads: [] } },
      'GET /api/uploads/:id/issues': { body: { issues: [], total: 0 } },
      'GET /api/uploads/:id/rows': { body: { rows: [], total: 0 } },
      'GET /api/uploads/:id': { body: { upload: { id: 'u' } } },
      'DELETE /api/uploads/:id': { status: 204 },
      'POST /api/uploads': { status: 201, body: { upload: { id: 'new' } } },
    });
    await listUploads({ status: 'in_progress', template: '', q: 'oct' });
    await listIssues('u', { severity: 'error', column: '', offset: 50, limit: 50 });
    await listRows('u', { offset: 0, limit: 50, onlyIssues: true });
    await getUpload('u');
    await removeUpload('u');
    const file = new File(['a\n1\n'], 'a.csv');
    expect(await createUpload({ mode: 'adhoc', name: 'A', hasHeaderRow: true, columns: [] }, file)).toEqual({ id: 'new' });
    expect(m.calls.map((c) => `${c.method} ${c.path}?${c.query}`)).toEqual([
      'GET /api/uploads?status=in_progress&q=oct',
      'GET /api/uploads/u/issues?severity=error&offset=50&limit=50',
      'GET /api/uploads/u/rows?offset=0&limit=50&onlyIssues=1',
      'GET /api/uploads/u?',
      'DELETE /api/uploads/u?',
      'POST /api/uploads?',
    ]);
    const form = m.to('POST /api/uploads')[0].form!;
    expect(JSON.parse(String(form.get('meta')))).toMatchObject({ mode: 'adhoc', name: 'A' });
    expect((form.get('file') as File).name).toBe('a.csv');
  });
  it('download links point at the generated files', () => {
    expect(downloads('u')).toEqual({
      templateFormat: '/api/uploads/u/export.csv',
      errorsMarked: '/api/uploads/u/export.csv?errors=1',
      errorReport: '/api/uploads/u/errors.csv',
      original: '/api/uploads/u/original',
    });
  });
});
