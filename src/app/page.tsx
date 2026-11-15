export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4 py-16">
      <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">node6 Labs</p>
      <h1 className="text-3xl font-semibold">Can ChatGPT find your business?</h1>
      <p className="text-neutral-600">
        AI Visibility Audit. The scoring API is live at <code className="rounded bg-neutral-100 px-1">/api/audit?url=yourdomain.com</code>.
        The audit form ships next.
      </p>
    </main>
  );
}
