'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type Role = 'professor' | 'student';

type CurrentUser = {
  username: string;
  role: Role;
};

type Transcript = {
  id: number;
  text: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

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

    try {
      const response = await apiFetch('/lectures/upload', {
        method: 'POST',
        body: JSON.stringify({})
      });

      if (!response.ok) {
        const message = await extractErrorMessage(response);
        setUploadMessage(message);
        return;
      }

      const data = (await response.json()) as { message: string };
      setUploadMessage(data.message);
    } catch {
      setUploadMessage('Upload failed.');
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

      {user.role === 'professor' ? (
        <section className="mb-6 rounded-xl border bg-white p-4">
          <h2 className="text-lg font-semibold">Professor Actions</h2>
          <button
            onClick={uploadLecture}
            className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
          >
            Upload Lecture
          </button>
          {uploadMessage ? <p className="mt-2 text-sm text-slate-700">{uploadMessage}</p> : null}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Transcripts</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {transcripts.map((item) => (
            <article key={item.id} className="rounded-xl border bg-white p-4">
              <p className="text-sm text-slate-500">Transcript #{item.id}</p>
              <p className="mt-1 text-slate-900">{item.text}</p>
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
