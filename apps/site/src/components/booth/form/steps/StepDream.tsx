import { Rise, fieldDelay } from "@/components/booth/Rise";
import { ChipSelector } from "@/components/booth/form/fields/ChipSelector";
import { CollectionCardGrid } from "@/components/booth/form/fields/CollectionCard";
import { Textarea } from "@/components/booth/form/fields/Textarea";
import { StepHeader } from "@/components/booth/form/StepHeader";
import { StepActions } from "@/components/booth/form/StepActions";
import { useLeadFormContext } from "@/components/booth/form/useLeadForm";
import { SETTINGS, type CollectionId } from "@/lib/booth/schema";

interface Props {
  onBack: () => void;
  onSubmit: () => void;
  loading: boolean;
}

const FIELDS_THIS_STEP = ["setting", "collectionsInterested", "notes"] as const;

export function StepDream({ onBack, onSubmit, loading }: Props) {
  const { register, watch, setValue, trigger, errors } = useLeadFormContext();

  const setting = watch("setting");
  const collections = (watch("collectionsInterested") ?? []) as CollectionId[];

  const toggleCollection = (id: CollectionId) => {
    const next = collections.includes(id) ? collections.filter((c) => c !== id) : [...collections, id];
    setValue("collectionsInterested", next, { shouldValidate: true });
  };

  const handleSubmit = () => {
    if (trigger(FIELDS_THIS_STEP, { shouldFocus: true })) onSubmit();
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <StepHeader
        eyebrow="03 — Setting the scene"
        headline="your vision"
        subhead="Indoors, outdoors, the experiences you're drawn to. Anything else you want us to know."
      />

      <div className="flex-1 min-h-0 overflow-y-auto sn-step-content flex flex-col sn-step-gap max-w-xl mx-auto w-full">
        <Rise delay={fieldDelay(0)}>
          <ChipSelector
            label="Setting"
            name="setting"
            options={SETTINGS}
            value={setting}
            onChange={(v) => setValue("setting", v as (typeof SETTINGS)[number], { shouldValidate: true })}
            error={errors.setting?.message}
          />
        </Rise>

        <Rise delay={fieldDelay(1)}>
          <CollectionCardGrid
            values={collections}
            onToggle={toggleCollection}
            error={errors.collectionsInterested?.message}
          />
        </Rise>

        <Rise delay={fieldDelay(2)}>
          <Textarea
            label="Anything else we should know?"
            placeholder="The vibe, must-haves, surprises…"
            rows={3}
            error={errors.notes?.message}
            {...register("notes")}
          />
        </Rise>
      </div>

      <div className="max-w-xl mx-auto w-full">
        <StepActions
          onBack={onBack}
          onNext={handleSubmit}
          nextLabel={loading ? "Sending…" : "Send Inquiry"}
          loading={loading}
        />
      </div>
    </div>
  );
}
