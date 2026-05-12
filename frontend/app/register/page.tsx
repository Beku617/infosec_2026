'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type Role = 'professor' | 'student';

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('student');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!username.trim() || !email.trim() || !password.trim()) {
      setError('All fields are required.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim(),
          password,
          role
        })
      });

      if (!response.ok) {
        const message = await extractErrorMessage(response);
        setError(message);
        return;
      }

      router.push('/login');
    } catch {
      setError('Unable to reach server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-5">
      <section className="w-full rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Register</h1>
        <p className="mt-1 text-sm text-slate-600">Create your account with role selection.</p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="username" className="mb-1 block text-sm font-medium">
              Username
            </label>
            <input
              id="username"
              className="w-full rounded-md border px-3 py-2"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
            />
          </div>

          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="w-full rounded-md border px-3 py-2"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="w-full rounded-md border px-3 py-2"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
          </div>

          <div>
            <label htmlFor="role" className="mb-1 block text-sm font-medium">
              Role
            </label>
            <select
              id="role"
              className="w-full rounded-md border px-3 py-2"
              value={role}
              onChange={(event) => setRole(event.target.value as Role)}
            >
              <option value="student">student</option>
              <option value="professor">professor</option>
            </select>
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-60"
          >
            {loading ? 'Creating account...' : 'Register'}
          </button>
        </form>

        <p className="mt-4 text-sm text-slate-600">
          Already registered?{' '}
          <Link className="font-medium text-slate-900 underline" href="/login">
            Login
          </Link>
        </p>
      </section>
    </main>
  );
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(data.message)) {
      return data.message[0] ?? 'Registration failed';
    }
    if (typeof data.message === 'string') {
      return data.message;
    }
  } catch {
    return 'Registration failed';
  }

  return 'Registration failed';
}
