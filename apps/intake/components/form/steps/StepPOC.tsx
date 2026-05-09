"use client";

import { motion } from "framer-motion";
import { useFormContext } from "react-hook-form";
import { TextField } from "@/components/form/fields/TextField";
import { ChipSelector } from "@/components/form/fields/ChipSelector";
import { StepHeader } from "@/components/form/StepHeader";
import { StepActions } from "@/components/form/StepActions";
import { fieldStaggerContainer, fieldStaggerItem } from "@/lib/motion";
import { PREFERRED_CONTACTS, RELATIONSHIPS, type Lead } from "@/lib/schema";

interface Props {
  onNext: () => void;
}

const FIELDS_THIS_STEP = [
  "pocName",
  "pocEmail",
  "pocPhone",
  "pocRelationship",
  "preferredContact",
] as const;

export function StepPOC({ onNext }: Props) {
  const {
    register,
    watch,
    setValue,
    trigger,
    getValues,
    formState: { errors },
  } = useFormContext<Lead>();

  const relationship = watch("pocRelationship");
  const contact = watch("preferredContact");

  const handleNext = async () => {
    const valid = await trigger([...FIELDS_THIS_STEP], { shouldFocus: true });
    if (valid) onNext();
  };

  // Light phone formatting on blur — non-destructive.
  const formatPhoneOnBlur = () => {
    const raw = (getValues("pocPhone") ?? "").replace(/[^\d]/g, "");
    if (raw.length === 10) {
      const formatted = `(${raw.slice(0, 3)}) ${raw.slice(3, 6)}-${raw.slice(6)}`;
      setValue("pocPhone", formatted, { shouldValidate: false });
    } else if (raw.length === 11 && raw.startsWith("1")) {
      const formatted = `+1 (${raw.slice(1, 4)}) ${raw.slice(4, 7)}-${raw.slice(7)}`;
      setValue("pocPhone", formatted, { shouldValidate: false });
    }
  };

  return (
    <div>
      <StepHeader
        eyebrow="01 — Who are we speaking with?"
        headline="Tell us about you"
        subhead="So we know who's bringing this celebration to life."
      />

      <motion.div
        variants={fieldStaggerContainer}
        initial="hidden"
        animate="visible"
        className="flex flex-col gap-6 max-w-md mx-auto"
      >
        <motion.div variants={fieldStaggerItem}>
          <TextField
            label="Your name"
            required
            autoComplete="name"
            inputMode="text"
            placeholder="Full name"
            error={errors.pocName?.message}
            {...register("pocName")}
          />
        </motion.div>

        <motion.div variants={fieldStaggerItem}>
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
        </motion.div>

        <motion.div variants={fieldStaggerItem}>
          <PhoneFieldWired
            error={errors.pocPhone?.message}
            register={register}
            onBlurExtra={formatPhoneOnBlur}
          />
        </motion.div>

        <motion.div variants={fieldStaggerItem}>
          <ChipSelector
            label="Your relationship to the couple"
            name="pocRelationship"
            options={RELATIONSHIPS}
            value={relationship}
            onChange={(v) =>
              setValue("pocRelationship", v as Lead["pocRelationship"], {
                shouldValidate: true,
              })
            }
            error={errors.pocRelationship?.message}
          />
        </motion.div>

        <motion.div variants={fieldStaggerItem}>
          <ChipSelector
            label="Preferred contact method"
            name="preferredContact"
            options={PREFERRED_CONTACTS}
            value={contact}
            onChange={(v) =>
              setValue("preferredContact", v as Lead["preferredContact"], {
                shouldValidate: true,
              })
            }
            error={errors.preferredContact?.message}
          />
        </motion.div>
      </motion.div>

      <div className="max-w-md mx-auto">
        <StepActions onNext={handleNext} />
      </div>
    </div>
  );
}

interface PhoneFieldWiredProps {
  error?: string;
  register: ReturnType<typeof useFormContext<Lead>>["register"];
  onBlurExtra: () => void;
}

function PhoneFieldWired({ error, register, onBlurExtra }: PhoneFieldWiredProps) {
  const reg = register("pocPhone");
  return (
    <TextField
      label="Phone"
      required
      type="tel"
      autoComplete="tel"
      inputMode="tel"
      placeholder="(504) 555-1234"
      error={error}
      name={reg.name}
      ref={reg.ref}
      onChange={reg.onChange}
      onBlur={async (e) => {
        await reg.onBlur(e);
        onBlurExtra();
      }}
    />
  );
}
