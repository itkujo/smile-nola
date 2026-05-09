import { IntakeForm } from "@/components/form/IntakeForm";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <IntakeForm />
    </main>
  );
}
