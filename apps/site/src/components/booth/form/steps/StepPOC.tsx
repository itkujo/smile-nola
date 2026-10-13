import { Rise, fieldDelay } from "@/components/booth/Rise";
import { TextField } from "@/components/booth/form/fields/TextField";
import { ChipSelector } from "@/components/booth/form/fields/ChipSelector";
import { StepHeader } from "@/components/booth/form/StepHeader";
import { StepActions } from "@/components/booth/form/StepActions";
import { useLeadFormContext } from "@/components/booth/form/useLeadForm";
import { PREFERRED_CONTACTS, RELATIONSHIPS } from "@/lib/booth/schema";

interface Props {
  onNext: () => void;
}

const FIELDS_THIS_STEP = ["pocName", "pocEmail", "pocPhone", "pocRelationship", "preferredContact"] as const;

export function StepPOC({ onNext }: Props) {
  const { register, watch, setValue, trigger, getValues, errors } = useLeadFormContext();

  const relationship = watch("pocRelationship");
  const contact = watch("preferredContact");

  const handleNext = () => {
    if (trigger(FIELDS_THIS_STEP, { shouldFocus: true })) onNext();
  };

  // Light phone formatting on blur — non-destructive.
  const phone = register("pocPhone");
  const formatPhoneOnBlur = () => {
    const raw = (getValues().pocPhone ?? "").replace(/[^\d]/g, "");
    if (raw.length === 10) {
      setValue("pocPhone", `(${raw.slice(0, 3)}) ${raw.slice(3, 6)}-${raw.slice(6)}`);
    } else if (raw.length === 11 && raw.startsWith("1")) {
      setValue("pocPhone", `+1 (${raw.slice(1, 4)}) ${raw.slice(4, 7)}-${raw.slice(7)}`);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <StepHeader
        eyebrow="01 — Who are we speaking with?"
        headline="tell us about you"
        subhead="So we know who's bringing this celebration to life."
      />

      <div className="flex-1 min-h-0 overflow-y-auto sn-step-content flex flex-col sn-step-gap max-w-md mx-auto w-full">
        <Rise delay={fieldDelay(0)}>
          <TextField
            label="Your name"
            required
            autoComplete="name"
            inputMode="text"
            placeholder="Full name"
            error={errors.pocName?.message}
            {...register("pocName")}
          />
        </Rise>

        <Rise delay={fieldDelay(1)}>
          <TextField
            label="Email"
            required
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            error={errors.pocEmail?.message}
            {...register("pocEmail")}
          />
        </Rise>

        <Rise delay={fieldDelay(2)}>
          <TextField
            label="Phone"
            required
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder="(504) 555-1234"
            error={errors.pocPhone?.message}
            name={phone.name}
            value={phone.value}
            onChange={phone.onChange}
            onBlur={(e) => {
              formatPhoneOnBlur();
              phone.onBlur(e);
            }}
          />
        </Rise>

        <Rise delay={fieldDelay(3)}>
          <ChipSelector
            label="Your relationship to the couple"
            name="pocRelationship"
            options={RELATIONSHIPS}
            value={relationship}
            onChange={(v) => setValue("pocRelationship", v as (typeof RELATIONSHIPS)[number], { shouldValidate: true })}
            error={errors.pocRelationship?.message}
          />
        </Rise>

        <Rise delay={fieldDelay(4)}>
          <ChipSelector
            label="Preferred contact method"
            name="preferredContact"
            options={PREFERRED_CONTACTS}
            value={contact}
            onChange={(v) =>
              setValue("preferredContact", v as (typeof PREFERRED_CONTACTS)[number], { shouldValidate: true })
            }
            error={errors.preferredContact?.message}
          />
        </Rise>
      </div>

      <div className="max-w-md mx-auto w-full">
        <StepActions onNext={handleNext} />
      </div>
    </div>
  );
}
