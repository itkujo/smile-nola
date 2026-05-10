import { IntakeForm } from "@/components/form/IntakeForm";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main className="relative h-screen overflow-hidden" style={{ height: "100dvh" }}>
      <IntakeForm />
    </main>
  );
}
