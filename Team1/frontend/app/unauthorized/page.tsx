import Link from 'next/link';

export default function UnauthorizedPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-5">
      <section className="w-full rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-semibold">403 - Access Denied</h1>
        <p className="mt-2 text-slate-600">Your role does not allow access to this route.</p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
        >
          Back to Dashboard
        </Link>
      </section>
    </main>
  );
}
