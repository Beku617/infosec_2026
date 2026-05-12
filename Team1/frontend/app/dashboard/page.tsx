'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type Role = 'admin' | 'professor' | 'student';

type CurrentUser = {
  username: string;
  role: Role;
};

type Transcript = {
  id: number;
  text: string;
  createdBy: string;
  createdAt: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'success' | 'error' | null>(null);
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const [newTranscriptText, setNewTranscriptText] = useState('');

  const apiFetch = useCallback(
    async (path: string, init?: RequestInit, retry = true): Promise<Response> => {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers ?? {})
        }
      });

      if (response.status !== 401 || !retry) {
        return response;
      }

      const refreshResponse = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include'
      });

      if (!refreshResponse.ok) {
        router.push('/login');
        return response;
      }

      return fetch(`${API_BASE_URL}${path}`, {
        ...init,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers ?? {})
        }
      });
    },
    [router]
  );

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setPageError(null);

    try {
      const meResponse = await apiFetch('/auth/me');
      if (meResponse.status === 401) {
        router.push('/login');
        return;
      }
      if (meResponse.status === 403) {
        router.push('/unauthorized');
        return;
      }
      if (!meResponse.ok) {
        setPageError('Failed to load profile.');
        return;
      }

      const currentUser = (await meResponse.json()) as CurrentUser;
      setUser(currentUser);

      const transcriptResponse = await apiFetch('/transcripts');
      if (transcriptResponse.status === 403) {
        router.push('/unauthorized');
        return;
      }
      if (!transcriptResponse.ok) {
        setPageError('Failed to load transcripts.');
        return;
      }

      const transcriptData = (await transcriptResponse.json()) as Transcript[];
      setTranscripts(transcriptData);

    } catch {
      setPageError('Unable to reach server.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, router]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const logout = async () => {
    await apiFetch('/auth/logout', { method: 'POST' }, false);
    router.push('/login');
    router.refresh();
  };

  const uploadLecture = async () => {
    setUploadMessage(null);
    setUploadStatus(null);

    try {
      const response = await apiFetch('/lectures/upload', {
        method: 'POST',
        body: JSON.stringify({})
      });

      if (!response.ok) {
        const message = await extractErrorMessage(response);
        setUploadMessage(message);
        setUploadStatus('error');
        return;
      }

      const data = (await response.json()) as { message: string; transcript?: Transcript };
      const uploadedTranscript = data.transcript;
      setUploadMessage(data.message || 'Successfully uploaded');
      setUploadStatus('success');
      if (uploadedTranscript) {
        setTranscripts((current) => [
          uploadedTranscript,
          ...current.filter((item) => item.id !== uploadedTranscript.id)
        ]);
      }
    } catch {
      setUploadMessage('Upload failed.');
      setUploadStatus('error');
    }
  };

  const createTranscriptByAdmin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAdminMessage(null);

    if (!newTranscriptText.trim()) {
      setAdminMessage('Transcript text is required.');
      return;
    }

    try {
      const response = await apiFetch('/admin/transcripts', {
        method: 'POST',
        body: JSON.stringify({
          text: newTranscriptText.trim()
        })
      });

      if (!response.ok) {
        setAdminMessage(await extractErrorMessage(response));
        return;
      }

      const transcript = (await response.json()) as Transcript;
      setTranscripts((current) => [transcript, ...current]);
      setNewTranscriptText('');
      setAdminMessage('Transcript created.');
    } catch {
      setAdminMessage('Failed to create transcript.');
    }
  };

  const deleteTranscriptByAdmin = async (transcriptId: number) => {
    setAdminMessage(null);

    try {
      const response = await apiFetch(`/admin/transcripts/${transcriptId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        setAdminMessage(await extractErrorMessage(response));
        return;
      }

      setTranscripts((current) => current.filter((item) => item.id !== transcriptId));
      setAdminMessage('Transcript deleted.');
    } catch {
      setAdminMessage('Failed to delete transcript.');
    }
  };

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center px-5">
        <p className="text-slate-600">Loading dashboard...</p>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-5 py-8">
      <nav className="mb-8 flex items-center justify-between rounded-xl border bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <p className="font-medium">{user.username}</p>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm capitalize">{user.role}</span>
        </div>
        <button onClick={logout} className="rounded-md border px-4 py-2 text-sm font-medium">
          Logout
        </button>
      </nav>

      {pageError ? <p className="mb-4 text-sm text-red-600">{pageError}</p> : null}
      {adminMessage ? <p className="mb-4 text-sm text-slate-700">{adminMessage}</p> : null}

      {user.role === 'professor' ? (
        <section className="mb-6 rounded-xl border bg-white p-4">
          <h2 className="text-lg font-semibold">Professor Actions</h2>
          <button
            onClick={uploadLecture}
            className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
          >
            Upload Lecture
          </button>
          {uploadMessage ? (
            <p className={`mt-2 text-sm ${uploadStatus === 'success' ? 'text-emerald-700' : 'text-red-600'}`}>
              {uploadMessage}
            </p>
          ) : null}
        </section>
      ) : null}

      {user.role === 'admin' ? (
        <section className="mb-6 grid gap-6">
          <article className="rounded-xl border bg-white p-4">
            <h2 className="text-lg font-semibold">Admin Transcript Management</h2>
            <form className="mt-3 flex gap-2" onSubmit={createTranscriptByAdmin}>
              <input
                className="w-full rounded-md border px-3 py-2"
                placeholder="Transcript text"
                value={newTranscriptText}
                onChange={(event) => setNewTranscriptText(event.target.value)}
              />
              <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white">
                Add
              </button>
            </form>
          </article>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Lectures</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {transcripts.length === 0 ? <p className="text-sm text-slate-500">No lectures uploaded yet.</p> : null}
          {transcripts.map((item) => (
            <article key={item.id} className="rounded-lg border bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{item.text}</p>
                  <p className="mt-1 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()}</p>
                </div>
                {user.role === 'admin' ? (
                  <button
                    onClick={() => void deleteTranscriptByAdmin(item.id)}
                    className="rounded-md border px-3 py-1 text-xs"
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(data.message)) {
      return data.message[0] ?? 'Request failed';
    }
    if (typeof data.message === 'string') {
      return data.message;
    }
  } catch {
    return response.status === 403 ? 'Forbidden' : 'Request failed';
  }

  return response.status === 403 ? 'Forbidden' : 'Request failed';
}
