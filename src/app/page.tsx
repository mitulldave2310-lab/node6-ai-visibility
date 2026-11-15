import { AuditForm } from "@/components/AuditForm";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-4 py-12 sm:py-20">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">node6 Labs</p>
        <h1 className="text-3xl font-semibold sm:text-4xl">Can ChatGPT find your business?</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          Type your website to see how well ChatGPT, Perplexity and Gemini can read and cite it. Free, no sign up.
        </p>
      </header>
      <AuditForm />
    </main>
  );
}
